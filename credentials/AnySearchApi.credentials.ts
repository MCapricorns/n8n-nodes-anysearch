import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class AnySearchApi implements ICredentialType {
	name = 'anySearchApi';

	displayName = 'AnySearch API';

	documentationUrl = 'https://github.com/MCapricorns/n8n-nodes-anysearch#credentials';

	icon: Icon = 'file:AnySearch.svg';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description:
				'AnySearch API key (starts with as_sk_). Register one via POST /v1/auth/email/register or at https://www.anysearch.com',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials?.apiKey}}',
			},
		},
	};

	// Does not consume search quota, so it is a safe connectivity check.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.anysearch.com',
			url: '/v1/domains',
			method: 'GET',
		},
	};
}
