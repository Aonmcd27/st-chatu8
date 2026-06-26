import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGrokImageRequest,
  convertImageGenerationResponse,
  installGrokImageFetchAdapter,
} from '../utils/grokImageFetchAdapter.js';

test('rewrites direct grok image chat requests to images generations', async () => {
  const rewrite = await buildGrokImageRequest(
    'http://127.0.0.1:8084/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-imagine-image',
        messages: [
          { role: 'system', content: 'ignore this system prompt' },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: 'data:image/png;base64,aaa' } },
              { type: 'text', text: 'a red apple on a white table' },
            ],
          },
        ],
      }),
    },
  );

  assert.equal(rewrite.url, 'http://127.0.0.1:8084/v1/images/generations');
  assert.equal(rewrite.init.method, 'POST');
  assert.equal(rewrite.init.headers.get('authorization'), 'Bearer test-key');
  assert.deepEqual(JSON.parse(rewrite.init.body), {
    model: 'grok-imagine-image',
    prompt: 'a red apple on a white table',
    n: 1,
    response_format: 'b64_json',
  });
});

test('does not rewrite non-grok image models', async () => {
  const rewrite = await buildGrokImageRequest(
    'http://127.0.0.1:8084/v1/chat/completions',
    {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    },
  );

  assert.equal(rewrite, null);
});

test('rewrites SillyTavern proxy requests using the configured custom url and headers', async () => {
  const rewrite = await buildGrokImageRequest(
    '/api/backends/chat-completions/generate',
    {
      method: 'POST',
      body: JSON.stringify({
        model: 'grok-imagine-image',
        custom_url: 'http://127.0.0.1:8084/v1',
        custom_include_headers: 'Authorization: Bearer proxy-key',
        messages: [{ role: 'user', content: 'a blue cup on a wood desk' }],
      }),
    },
  );

  assert.equal(rewrite.url, '/proxy/http://127.0.0.1:8084/v1/images/generations');
  assert.equal(rewrite.init.headers.get('authorization'), 'Bearer proxy-key');
  assert.deepEqual(JSON.parse(rewrite.init.body), {
    model: 'grok-imagine-image',
    prompt: 'a blue cup on a wood desk',
    n: 1,
    response_format: 'b64_json',
  });
});

test('installed adapter keeps SillyTavern proxy requests same-origin to avoid browser CORS', async () => {
  const calls = [];
  const fakeGlobal = {
    Headers,
    Response,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [{ b64_json: 'proxy-image' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };

  installGrokImageFetchAdapter(fakeGlobal);

  const response = await fakeGlobal.fetch('/api/backends/chat-completions/generate', {
    method: 'POST',
    headers: { 'x-csrf-token': 'csrf-token' },
    body: JSON.stringify({
      model: 'grok-imagine-image',
      custom_url: 'https://aether.example/v1',
      custom_include_headers: 'Authorization: Bearer proxy-key',
      messages: [{ role: 'user', content: 'a silver lantern' }],
    }),
  });
  const body = await response.json();

  assert.equal(calls[0].url, '/proxy/https://aether.example/v1/images/generations');
  assert.equal(calls[0].init.headers.get('authorization'), 'Bearer proxy-key');
  assert.equal(calls[0].init.headers.get('x-csrf-token'), 'csrf-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: 'grok-imagine-image',
    prompt: 'a silver lantern',
    n: 1,
    response_format: 'b64_json',
  });
  assert.equal(
    body.choices[0].message.content[0].image_url.url,
    'data:image/png;base64,proxy-image',
  );
});

test('converts image generation b64 responses to chat image content', () => {
  const converted = convertImageGenerationResponse(
    {
      id: 'image-id',
      created: 123,
      data: [{ b64_json: 'abc123' }],
    },
    'grok-imagine-image',
  );

  assert.equal(converted.id, 'image-id');
  assert.equal(converted.object, 'chat.completion');
  assert.equal(converted.model, 'grok-imagine-image');
  assert.equal(
    converted.choices[0].message.content[0].image_url.url,
    'data:image/png;base64,abc123',
  );
});

test('converts jpeg b64 image responses with the matching data url mime type', () => {
  const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
  const converted = convertImageGenerationResponse(
    {
      data: [{ b64_json: jpegBase64 }],
    },
    'grok-imagine-image',
  );

  assert.equal(
    converted.choices[0].message.content[0].image_url.url,
    `data:image/jpeg;base64,${jpegBase64}`,
  );
});

test('preserves data urls returned in image generation b64 fields', () => {
  const converted = convertImageGenerationResponse(
    {
      data: [{ b64_json: 'data:image/jpeg;base64,abc123' }],
    },
    'grok-imagine-image',
  );

  assert.equal(
    converted.choices[0].message.content[0].image_url.url,
    'data:image/jpeg;base64,abc123',
  );
});

test('installed adapter returns chat-shaped image content from rewritten fetches', async () => {
  const calls = [];
  const fakeGlobal = {
    Headers,
    Response,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [{ b64_json: 'abc123' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };

  installGrokImageFetchAdapter(fakeGlobal);

  const response = await fakeGlobal.fetch('http://127.0.0.1:8084/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'grok-imagine-image',
      messages: [{ role: 'user', content: 'a green vase' }],
    }),
  });
  const body = await response.json();

  assert.equal(calls[0].url, 'http://127.0.0.1:8084/v1/images/generations');
  assert.equal(
    body.choices[0].message.content[0].image_url.url,
    'data:image/png;base64,abc123',
  );
});
