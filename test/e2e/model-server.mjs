// A deterministic local chat model drives a real n8n AI Agent and AnySearch tool.
import { createServer } from 'node:http';

export async function createModelServer() {
	const state = { calls: 0, toolResultSeen: false };
	const server = createServer(async (request, response) => {
		try {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const body = JSON.parse(Buffer.concat(chunks).toString());
			state.calls++;
			const toolResult = body.messages?.findLast((message) => message.role === 'tool');
			const tool = body.tools?.[0];
			if (!toolResult && !tool) throw new Error('Expected an available search tool');
			state.toolResultSeen ||= Boolean(toolResult);
			const message = toolResult
				? {
						role: 'assistant',
						content:
							typeof toolResult.content === 'string'
								? toolResult.content
								: JSON.stringify(toolResult.content),
					}
				: {
						role: 'assistant',
						content: null,
						tool_calls: [
							{
								id: 'call_anysearch_e2e',
								type: 'function',
								function: {
									name: tool.function.name,
									arguments: JSON.stringify({ query: 'What is the capital of France?' }),
								},
							},
						],
					};
			const finishReason = toolResult ? 'stop' : 'tool_calls';
			if (body.stream) {
				response.writeHead(200, { 'content-type': 'text/event-stream' });
				const delta = toolResult
					? { role: 'assistant', content: message.content }
					: {
							role: 'assistant',
							tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })),
						};
				for (const choice of [
					{ index: 0, delta, finish_reason: null },
					{ index: 0, delta: {}, finish_reason: finishReason },
				]) {
					response.write(
						'data: ' +
							JSON.stringify({
								id: 'chatcmpl-e2e',
								object: 'chat.completion.chunk',
								created: 0,
								model: 'e2e-model',
								choices: [choice],
							}) +
							'\n\n',
					);
				}
				response.end('data: [DONE]\n\n');
			} else {
				response.writeHead(200, { 'content-type': 'application/json' });
				response.end(
					JSON.stringify({
						id: 'chatcmpl-e2e',
						object: 'chat.completion',
						created: 0,
						model: 'e2e-model',
						choices: [{ index: 0, message, finish_reason: finishReason }],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					}),
				);
			}
		} catch {
			response.writeHead(400, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ error: { message: 'Invalid local model test request' } }));
		}
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	return {
		state,
		url: 'http://127.0.0.1:' + server.address().port + '/v1',
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}
