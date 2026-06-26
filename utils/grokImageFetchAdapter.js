const GROK_IMAGE_MODEL_PREFIX = /^grok-imagine/i;

function getHeaderCtor(globalObject = globalThis) {
  return globalObject?.Headers || globalThis.Headers;
}

function getResponseCtor(globalObject = globalThis) {
  return globalObject?.Response || globalThis.Response;
}

function getRequestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input.url === 'string') return input.url;
  return '';
}

function getRequestMethod(input, init = {}) {
  return String(init?.method || input?.method || 'GET').toUpperCase();
}

function getRequestHeaders(input, init = {}, globalObject = globalThis) {
  const HeadersCtor = getHeaderCtor(globalObject);
  return new HeadersCtor(init?.headers || input?.headers || {});
}

async function getRequestBodyText(input, init = {}) {
  const body = init?.body;

  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (body && typeof body.text === 'function') return body.text();

  if (input && typeof input.clone === 'function') {
    try {
      return await input.clone().text();
    } catch {
      return '';
    }
  }

  return '';
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripWrappingQuotes(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function applyCustomHeaders(headers, rawHeaders) {
  if (!rawHeaders || typeof rawHeaders !== 'string') return;

  for (const line of rawHeaders.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    headers.set(match[1].trim(), stripWrappingQuotes(match[2]));
  }
}

function extractTextFromContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        if (part.type === 'text') return part.text || part.content || '';
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (content && typeof content === 'object') {
    return String(content.text || content.content || '').trim();
  }
  return '';
}

function extractPrompt(body) {
  if (typeof body?.prompt === 'string' && body.prompt.trim()) {
    return body.prompt.trim();
  }

  if (!Array.isArray(body?.messages)) return '';

  for (let index = body.messages.length - 1; index >= 0; index -= 1) {
    const message = body.messages[index];
    if (message?.role !== 'user') continue;
    const text = extractTextFromContent(message.content);
    if (text) return text;
  }

  for (let index = body.messages.length - 1; index >= 0; index -= 1) {
    const text = extractTextFromContent(body.messages[index]?.content);
    if (text) return text;
  }

  return '';
}

function isChatCompletionsUrl(url) {
  return /\/chat\/completions(?:[?#].*)?$/i.test(url);
}

function isSillyTavernChatProxyUrl(url) {
  return /\/api\/backends\/chat-completions\/generate(?:[?#].*)?$/i.test(url);
}

function appendImagesGenerations(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '') + '/images/generations';
}

function getImageGenerationUrl(url, body) {
  if (typeof body?.custom_url === 'string' && body.custom_url.trim()) {
    return appendImagesGenerations(body.custom_url.trim());
  }

  return String(url).replace(/\/chat\/completions(?:[?#].*)?$/i, '/images/generations');
}

function getModel(body) {
  return body?.model || body?.custom_model || body?.image_model || '';
}

export async function buildGrokImageRequest(input, init = {}, globalObject = globalThis) {
  const url = getRequestUrl(input);
  const method = getRequestMethod(input, init);

  if (!url || method !== 'POST') return null;
  if (!isChatCompletionsUrl(url) && !isSillyTavernChatProxyUrl(url)) return null;

  const body = parseJson(await getRequestBodyText(input, init));
  const model = getModel(body);
  if (!GROK_IMAGE_MODEL_PREFIX.test(String(model))) return null;

  const prompt = extractPrompt(body);
  if (!prompt) return null;

  const headers = getRequestHeaders(input, init, globalObject);
  applyCustomHeaders(headers, body.custom_include_headers);
  headers.set('content-type', 'application/json');

  const count = Number(body.n || body.num_images || 1);
  const payload = {
    model,
    prompt,
    n: Number.isFinite(count) && count > 0 ? count : 1,
    response_format: 'b64_json',
  };

  return {
    url: getImageGenerationUrl(url, body),
    init: {
      ...init,
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    },
  };
}

export function convertImageGenerationResponse(result, model) {
  const firstImage = result?.data?.[0] || {};
  const imageUrl = firstImage.b64_json
    ? `data:image/png;base64,${firstImage.b64_json}`
    : firstImage.url;

  if (!imageUrl) {
    throw new Error('Grok image response did not include b64_json or url');
  }

  const now = Math.floor(Date.now() / 1000);
  return {
    id: result.id || `grok-image-${now}`,
    object: 'chat.completion',
    created: result.created || now,
    model,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      },
    ],
    usage: result.usage,
  };
}

export function installGrokImageFetchAdapter(globalObject = globalThis) {
  if (!globalObject || globalObject.__stChatu8GrokImageFetchAdapterInstalled) return false;
  if (typeof globalObject.fetch !== 'function') return false;

  const originalFetch = globalObject.fetch.bind(globalObject);
  const ResponseCtor = getResponseCtor(globalObject);
  if (!ResponseCtor) return false;

  globalObject.fetch = async (input, init = {}) => {
    const rewrite = await buildGrokImageRequest(input, init, globalObject);
    if (!rewrite) return originalFetch(input, init);

    const imageResponse = await originalFetch(rewrite.url, rewrite.init);
    if (!imageResponse.ok) return imageResponse;

    const imageResult = await imageResponse.clone().json();
    const imagePayload = JSON.parse(rewrite.init.body);
    const chatResult = convertImageGenerationResponse(imageResult, imagePayload.model);

    return new ResponseCtor(JSON.stringify(chatResult), {
      status: imageResponse.status,
      statusText: imageResponse.statusText,
      headers: {
        'content-type': 'application/json',
      },
    });
  };

  globalObject.__stChatu8GrokImageFetchAdapterInstalled = true;
  return true;
}

if (typeof window !== 'undefined') {
  installGrokImageFetchAdapter(window);
}
