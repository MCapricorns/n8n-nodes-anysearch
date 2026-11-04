// Redirect only the isolated fault workflow's AnySearch transport to a local HTTP server.
const http = require('node:http');
const https = require('node:https');
const original = https.request;
https.request = function (options, callback) {
	if (options.hostname !== 'api.anysearch.com') return original.call(this, options, callback);
	return http.request(
		{
			...options,
			protocol: 'http:',
			hostname: '127.0.0.1',
			port: Number(process.env.ANYSEARCH_E2E_FAULT_PORT),
			agent: false,
		},
		callback,
	);
};
