import * as vscode from 'vscode';
import {
  RecordsClient,
  createRecordsClient,
} from '@casual-simulation/aux-records/RecordsClient';
import {
  getSessionKeyExpiration,
  isExpired,
  KnownErrorCodes,
} from '@casual-simulation/aux-common';
import { GetDataFailure, GetDataResult } from '@casual-simulation/aux-records';
import { log } from '@helloao/tools';

const client = createRecordsClient('https://api.ao.bot');

export async function getClient(
  context: vscode.ExtensionContext
): Promise<RecordsClient> {
  if (!client.sessionKey) {
    let sessionKey = await context.secrets.get('aoBotSessionKey');

    if (sessionKey) {
      const expiration = getSessionKeyExpiration(sessionKey);
      if (!isExpired(expiration)) {
        client.sessionKey = sessionKey;
      } else {
        await login(context);
      }
    } else {
      await login(context);
    }
  }

  return client;
}

export function getOptions() {
  return {
    headers: getHeaders(),
  };
}

export function getHeaders() {
  return {
    origin: 'https://auth.ao.bot',
  };
}

export async function login(context: vscode.ExtensionContext): Promise<void> {
  // Login
  const email = await vscode.window.showInputBox({
    prompt: 'Enter your email address',
    title: 'ao.bot Login',
    validateInput: (value: string) => {
      if (!value) {
        return 'Email cannot be empty.';
      }
      return null; // Return null if the input is valid
    },
  });

  const loginResult = await client.requestLogin(
    {
      address: email,
      addressType: 'email',
    },
    getOptions()
  );

  if (!loginResult.success) {
    vscode.window.showErrorMessage(`Login failed: ${loginResult.errorMessage}`);
    throw new Error(`Login failed: ${loginResult.errorMessage}`);
  } else {
    vscode.window.showInformationMessage(
      'Code sent! Please check your email for the verification code.'
    );
  }

  await vscode.window.showInputBox({
    prompt: 'Enter the verification code',
    title: 'ao.bot Verification Code',
    ignoreFocusOut: true,
    validateInput: async (value: string) => {
      if (!value) {
        return 'Verification code cannot be empty.';
      }

      const result = await client.completeLogin(
        {
          requestId: loginResult.requestId,
          userId: loginResult.userId,
          code: value,
        },
        getOptions()
      );

      if (!result.success) {
        return `Login failed: ${result.errorMessage}`;
      } else {
        vscode.window.showInformationMessage(
          'Login successful! You are now logged in.'
        );
        client.sessionKey = result.sessionKey;
        await context.secrets.store('aoBotSessionKey', client.sessionKey);
      }

      return null; // Return null if the input is valid
    },
  });
}

export async function callProcedure(
  context: vscode.ExtensionContext,
  operation: string,
  input: any,
  query?: any
) {
  const client = await getClient(context);
  while (true) {
    const result = await client.callProcedure(
      operation,
      input,
      getOptions(),
      query
    );

    if (result.success === false && result.errorCode === 'not_logged_in') {
      const loginResponse = await vscode.window.showQuickPick(
        ['Log in', 'Cancel'],
        {
          title: 'You are not logged in. Do you want to log in and try again?',
        }
      );

      if (loginResponse === 'Log in') {
        await login(context);
      } else {
        return result;
      }
    } else {
      return result;
    }
  }
}

export async function getAwsCredentials(
  context: vscode.ExtensionContext
): Promise<{ accessKeyId: string; secretAccessKey: string } | GetDataFailure> {
  const result: GetDataResult = await callProcedure(context, 'getData', {
    recordName: '43716a62-6b01-483e-a274-94d1de29d08d',
    address: 'awsAccessKey',
  });

  if (result.success) {
    return result.data;
  } else {
    const logger = log.getLogger();
    logger.error('Failed to get AWS credentials:', result);
    return result;
  }
}
