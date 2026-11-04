import type {
	ICredentialDataDecryptedObject,
	IHttpRequestOptions,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

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
		const apiKey = typeof credentials.apiKey === 'string' ? credentials.apiKey.trim() : '';
		if (apiKey === '') {
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
