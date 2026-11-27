import type {
	ICredentialDataDecryptedObject,
	IHttpRequestOptions,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export function readAnySearchApiKey(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		throw new Error('The selected credential must contain an API Key string.');
	}
	return value.trim() || undefined;
}

export class AnySearchApi implements ICredentialType {
	name = 'anySearchApi';

	displayName = 'AnySearch API';

	documentationUrl = 'https://github.com/MCapricorns/n8n-nodes-anysearch#credentials';

	icon: Icon = { light: 'file:AnySearch.svg', dark: 'file:AnySearch.dark.svg' };

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description:
				'API key from https://www.anysearch.com/console/api-keys. Leave blank to use anonymous access.',
		},
	];

	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const apiKey = readAnySearchApiKey(credentials.apiKey);
		if (apiKey === undefined) {
			return requestOptions;
		}
		return {
			...requestOptions,
			headers: {
				...requestOptions.headers,
				Authorization: `Bearer ${apiKey}`,
			},
		};
	}

	// Does not consume search quota, so it is a safe connectivity check.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.anysearch.com',
			url: '/v1/domains',
			method: 'GET',
		},
	};
}
