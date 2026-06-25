const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8008;

app.use(express.json({ limit: '50mb' }));
app.use(cors());

// --- Available Models ---
const AVAILABLE_MODELS = [
    { id: 'gemini-2.5-flash-image', object: 'model', created: 1700000000, owned_by: 'google' },
    { id: 'gemini-3-pro-image', object: 'model', created: 1700000000, owned_by: 'google' },
    { id: 'imagen-4.0-generate-001', object: 'model', created: 1700000000, owned_by: 'google' },
    { id: 'imagen-4.0-ultra-generate-001', object: 'model', created: 1700000000, owned_by: 'google' },
];

// --- State Management ---

// Queue for incoming generation tasks
let taskQueue = [];
// Map to hold pending external requests (jobId -> { req, res, retries, triedClients })
let pendingJobs = {};
// Pool of available frontend clients (each element is a `res` object)
let availableClients = [];
// Map to track all currently connected clients by their unique ID
const allClients = new Map();

// --- Middleware for API Key Authentication ---
const apiKeyAuth = (req, res, next) => {
    const apiKey = process.env.API_KEY || '123456';
    if (apiKey) {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
            return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
        }
    }
    next();
};

// --- Core Task Dispatching Logic ---

/**
 * Dispatches tasks from the queue to available clients.
 * This function is the heart of the load balancer.
 */
function dispatchTasks() {
    // Loop as long as there are tasks and available clients
    while (taskQueue.length > 0 && availableClients.length > 0) {
        const task = taskQueue.shift(); // Get the next task
        const clientRes = availableClients.shift(); // Get an available client

        const job = pendingJobs[task.jobId];
        if (!job) {
            console.error(`[${new Date().toISOString()}] Job ${task.jobId} not found in pendingJobs. Skipping.`);
            continue; // Should not happen, but good to be safe
        }

        // The clientRes object already has a unique clientId from the /api/get-task endpoint
        job.assignedClientId = clientRes.clientId;

        console.log(`[${new Date().toISOString()}] Dispatching job ${task.jobId} to client ${clientRes.clientId}`);

        // Send the task to the client
        clientRes.json(task);
    }
}


// --- API Endpoints ---

// 1. Endpoint for clients to request tasks (Long Polling)
app.get('/api/get-task', (req, res) => {
    const { clientId } = req.query;

    if (!clientId) {
        return res.status(400).json({ error: 'clientId query parameter is required.' });
    }

    // Clean up any stale connections with the same clientId before adding the new one
    const staleClientIndex = availableClients.findIndex(client => client.clientId === clientId);
    if (staleClientIndex !== -1) {
        console.warn(`[${new Date().toISOString()}] Stale connection for client ${clientId} found in available pool. Removing.`);
        const staleRes = availableClients.splice(staleClientIndex, 1)[0];
        staleRes.end(); // Explicitly end the stale response
    }

    res.clientId = clientId; // Attach ID to the response object for tracking
    allClients.set(clientId, res);
    availableClients.push(res);
    console.log(`[${new Date().toISOString()}] Client ${clientId} connected. Pool size: ${availableClients.length}`);

    // Handle client disconnection
    req.on('close', () => {
        // Only remove the client if it's the *current* active response object.
        // This prevents a race condition where a new connection's 'close' event for a stale
        // connection removes the newly established, active connection.
        if (allClients.get(clientId) === res) {
            allClients.delete(clientId);
            const index = availableClients.findIndex(client => client.clientId === clientId);
            if (index !== -1) {
                availableClients.splice(index, 1);
            }
            console.log(`[${new Date().toISOString()}] Client ${clientId} disconnected and removed. Pool size: ${availableClients.length}`);
        } else {
            console.log(`[${new Date().toISOString()}] A stale connection for client ${clientId} was closed.`);
        }
    });

    // Immediately try to dispatch if there are pending tasks
    dispatchTasks();
});

// 2. Endpoint for clients to submit completed tasks
app.post('/api/submit-task', (req, res) => {
    const { jobId, result, error } = req.body;
    const job = pendingJobs[jobId];

    if (!job) {
        console.error(`[${new Date().toISOString()}] Received result for unknown job ID: ${jobId}`);
        return res.status(404).send('Job not found');
    }

    console.log(`[${new Date().toISOString()}] Received result for job ${jobId}. Success: ${!error}`);

    // --- Intelligent Error Handling & Retry Logic ---
    if (error) {
        // Check for rate limit error (429)
        if (error.status === 429) {
            console.warn(`[${new Date().toISOString()}] Job ${jobId} failed with 429 on client ${job.assignedClientId}. Attempting retry.`);

            job.triedClients.add(job.assignedClientId);

            // New failure condition: Check if all currently connected clients have tried and failed this job.
            const allClientIds = Array.from(allClients.keys());
            const allTried = allClientIds.every(id => job.triedClients.has(id));

            if (allClientIds.length > 0 && allTried) {
                console.error(`[${new Date().toISOString()}] Job ${jobId} has failed on all ${allClientIds.length} connected clients. Returning 429 to user.`);
                job.res.status(429).json({
                    error: 'Too Many Requests: All available clients are rate-limited.',
                    jobId: jobId,
                    details: `Failed on clients: ${Array.from(job.triedClients).join(', ')}`
                });
                delete pendingJobs[jobId];
                return res.status(200).send('Acknowledged final rate limit failure.');
            }

            // Re-queue the task at the front for immediate re-dispatch
            taskQueue.unshift({ jobId, ...job.taskData });
            console.log(`[${new Date().toISOString()}] Job ${jobId} re-queued for another attempt.`);

            // The client that failed is now free, so it will re-poll and be added back to the pool.
            // We can try dispatching again immediately.
            dispatchTasks();

            return res.status(200).send('Acknowledged, task re-queued.');
        } else {
            // For any other error, fail the job immediately
            console.error(`[${new Date().toISOString()}] Job ${jobId} failed with a fatal error:`, error);
            job.res.status(error.status || 500).json({
                error: error.message || 'An unexpected error occurred.',
                details: error,
                jobId: jobId,
            });
            delete pendingJobs[jobId];
            return res.status(200).send('Acknowledged fatal error.');
        }
    }

    // --- Success Case ---
    if (result) {
        // Build OpenAI-compatible response
        const content = [];

        // Add text content if present
        if (result.text) {
            content.push({ type: 'text', text: result.text });
        }

        // Add image content if present
        if (result.imageUrl) {
            content.push({
                type: 'image_url',
                image_url: { url: result.imageUrl }
            });
        }

        // Respond with standard OpenAI format
        job.res.status(200).json({
            id: jobId,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: job.taskData.model,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: content
                },
                finish_reason: 'stop'
            }],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            }
        });
        delete pendingJobs[jobId];
    }

    // Acknowledge the submission from the client
    res.status(200).send('Task result received');
});

// --- Generic Task Handler for External API Calls ---
const handleApiRequest = (req, res, taskData) => {
    const jobId = crypto.randomBytes(16).toString('hex');
    console.log(`[${new Date().toISOString()}] Received new job ${jobId}`);

    pendingJobs[jobId] = {
        req,
        res,
        taskData,
        retries: 0,
        triedClients: new Set() // Keep track of clients that failed this job
    };

    taskQueue.push({ jobId, ...taskData });

    dispatchTasks(); // Attempt to dispatch the new task immediately
};

// 3. OpenAI-compatible endpoint
app.post('/v1/chat/completions', apiKeyAuth, (req, res) => {
    const { model, messages, config } = req.body;

    // Convert OpenAI messages format to original history format for frontend client
    let history = [];
    if (messages && Array.isArray(messages)) {
        history = messages.map(msg => {
            // Convert role: 'assistant' back to 'model'
            const role = msg.role === 'assistant' ? 'model' : msg.role;
            // Convert content to parts
            let parts = [];
            if (Array.isArray(msg.content)) {
                parts = msg.content;
            } else if (typeof msg.content === 'string') {
                parts = [{ type: 'text', text: msg.content }];
            }
            return { role, parts };
        }).filter(entry => entry.parts.length > 0);
    }

    // The task data uses original history format for frontend client compatibility
    const taskData = { model, history, config };

    handleApiRequest(req, res, taskData);
});

// 4. Vertex AI-compatible endpoints
const vertexPredictHandler = (req, res) => {
    // The model name from the URL will include the trailing ':predict'
    let modelFromPath = req.params.model;

    // Robustly remove the ':predict' suffix if it exists
    const suffix = ':predict';
    if (modelFromPath.endsWith(suffix)) {
        modelFromPath = modelFromPath.slice(0, -suffix.length);
    }

    const { instances, parameters } = req.body;

    // Transform the Vertex AI request into the format our client understands
    const taskData = {
        model: `imagen-4.0-${modelFromPath}`, // Reconstruct the full model name
        // The client will know to look for `instances` for imagen models
        instances,
        parameters,
        // Add a flag to make it explicit
        isVertex: true,
    };

    handleApiRequest(req, res, taskData);
};

// Use a less ambiguous route that captures the entire model string
app.post('/v1beta/models/imagen-4.0-:model(*)', apiKeyAuth, vertexPredictHandler);


// OpenAI-compatible models endpoint
app.get('/v1/models', apiKeyAuth, (req, res) => {
    res.status(200).json({
        object: 'list',
        data: AVAILABLE_MODELS
    });
});

// Health check endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'ok',
        message: 'Hugging Face WSS Server is running.',
        timestamp: new Date().toISOString()
    });
});

// --- Server Initialization ---
app.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] Gemini HTTP Proxy Server listening on port ${PORT}`);
    console.log(`[${new Date().toISOString()}] Load balancing and 429-retry mode enabled.`);
});
