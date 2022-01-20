import {CANCELED, CancellationTokenSource, CancellationToken, uncancelableToken} from 'neuroglancer/util/cancellation';
import {responseJson, cancellableFetchOk, responseArrayBuffer, ResponseTransform} from 'neuroglancer/util/http_request';
import {fetchWithCredentials} from 'neuroglancer/credentials_provider/http_request';
import {CredentialsProvider, /*makeUncachedCredentialsGetter as */makeCredentialsGetter} from 'neuroglancer/credentials_provider';
import {StatusMessage} from 'neuroglancer/status';

export type DefaultTokenType = string;

interface HttpCall {
  method: 'GET' | 'POST' | 'DELETE' | 'HEAD';
  url: string;
  payload?: string;
}

export function responseText(response: Response): Promise<any> {
  return response.text();
}

export function makeRequest(
  httpCall: HttpCall & { responseType: 'arraybuffer' },
  cancellationToken?: CancellationToken): Promise<ArrayBuffer>;

export function makeRequest(
  httpCall: HttpCall & { responseType: 'json' }, cancellationToken?: CancellationToken): Promise<any>;

export function makeRequest(
  httpCall: HttpCall & { responseType: '' }, cancellationToken?: CancellationToken): Promise<any>;

export function makeRequest(
  httpCall: HttpCall & { responseType: XMLHttpRequestResponseType },
  cancellationToken: CancellationToken = uncancelableToken): any {
    let requestInfo = `${httpCall.url}`;
    let init = { method: httpCall.method, body: httpCall.payload };

    if (httpCall.responseType === '') {
      return cancellableFetchOk(requestInfo, init, responseText, cancellationToken);
    } else if (httpCall.responseType === 'arraybuffer') {
      return cancellableFetchOk(requestInfo, init, responseArrayBuffer, cancellationToken);
    } {
      return cancellableFetchOk(requestInfo, init, responseJson, cancellationToken);
    }
}

export function makeRequestWithCredentials<TToken>(
  credentialsProvider: CredentialsProvider<TToken>,
  tokenRefreshable: Boolean,
  httpCall: HttpCall & { responseType: 'arraybuffer' },
  cancellationToken?: CancellationToken): Promise<ArrayBuffer>;

export function makeRequestWithCredentials<TToken>(
  credentialsProvider: CredentialsProvider<TToken>,
  tokenRefreshable: Boolean,
  httpCall: HttpCall & { responseType: 'json' }, cancellationToken?: CancellationToken): Promise<any>;

export function makeRequestWithCredentials<TToken>(
  credentialsProvider: CredentialsProvider<TToken>,
  tokenRefreshable: Boolean,
  httpCall: HttpCall & { responseType: '' }, cancellationToken?: CancellationToken): Promise<any>;

export function makeRequestWithCredentials<TToken>(
  credentialsProvider: CredentialsProvider<TToken>,
  tokenRefreshable: Boolean,
  httpCall: HttpCall & { responseType: XMLHttpRequestResponseType },
  cancellationToken: CancellationToken = uncancelableToken): Promise<any> {
    const requestInit: RequestInit = { method: httpCall.method, body: httpCall.payload };
    if (requestInit.method === 'POST') { //Only supports posting json
      requestInit.headers = {
        'Content-Type': 'application/json',
      };
    }
    return fetchWithFlyEMCredentials(
      credentialsProvider,
      tokenRefreshable,
      httpCall.url,
      requestInit,
      httpCall.responseType === '' ? responseText : (httpCall.responseType === 'json' ? responseJson : responseArrayBuffer),
      cancellationToken
    );
}

function  applyCredentials<TToken>(input: string) {
  return (credentials: TToken, init: RequestInit) => {
    let newInit: RequestInit = { ...init };

    if (credentials) {
      newInit.headers = {...newInit.headers, Authorization: `Bearer ${credentials}`};
    } else if (input.startsWith('https:')) {
      // DVID https without credentials provided expects credentials stored in the browser
      newInit.credentials = 'include';
    }

    return newInit;
  };
}

function fetchWithFlyEMCredentials<T, TToken>(
  credentialsProvider: CredentialsProvider<TToken>,
  tokenRefreshable: Boolean,
  input: string,
  init: RequestInit,
  transformResponse: ResponseTransform<T>,
  cancellationToken: CancellationToken = uncancelableToken): Promise<T> {
  return fetchWithCredentials(
    credentialsProvider, input, init, transformResponse,
    applyCredentials(input),
    error => {
      const { status } = error;
      if (status === 403 || status === 401) {
        // Authorization needed.  Retry with refreshed token.
        if (tokenRefreshable) {
          return 'refresh';
        }
      }
      if (status === 504) {
        // Gateway timeout can occur if the server takes too long to reply.  Retry.
        return 'retry';
      }
      throw error;
    },
    cancellationToken);
}

interface AuthResponse {
  id_token: DefaultTokenType
}

interface AuthResponseProvider {
  getAuthResponse: () => AuthResponse
}

interface AuthClient {
  auth: AuthResponseProvider
}

interface ClioNeurohub {
  clio: AuthClient
}

interface NeurohubWindow {
  neurohub: ClioNeurohub
}

const DEBUG_NEUROHUB_CREDENTIALS = false;

const mockWindow: NeurohubWindow = {
  neurohub: {
    clio: {
        auth: {
          getAuthResponse: () => {
            return {id_token: "<test-token>"};
          }
        }
    }
  }
};

function getNeurohubToken(w: any) {
  if ('neurohub' in w) {
    return Promise.resolve((<NeurohubWindow><unknown>w).neurohub.clio.auth.getAuthResponse().id_token);
  } else {
    return Promise.resolve('');
  }
}

export class FlyEMCredentialsProvider<Token> extends CredentialsProvider<Token> {
  constructor(public authServer: string, private retry?: () => void) {
    super();
  }

  private getAuthToken(
    authServer: string,
    cancellationToken = uncancelableToken) {
    // console.log('getAuthToken:', authServer);
    if (!authServer) {
      // throw Error('token failure test');
      return Promise.resolve('');
    } else if (authServer.startsWith('token:')) {
      return Promise.resolve(authServer.substring(6));
    } else if (authServer == 'neurohub') {
      return getNeurohubToken(DEBUG_NEUROHUB_CREDENTIALS ? mockWindow : window);
    } else {
      const headers = new Headers();
      // headers.set('Access-Control-Allow-Origin', '*');
      return cancellableFetchOk(
        authServer,
        {'method': 'GET', headers},
        responseText,
        cancellationToken).catch(
          () => {
            return cancellableFetchOk(
              authServer,
              {'method': 'GET'},
              responseText,
              cancellationToken)/*.then(
                response => 'noinclude:' + response
              )*/;
          }
        );
    }
  }

  get = makeCredentialsGetter(cancellationToken => {
    const status = new StatusMessage(/*delay=*/true);
    let cancellationSource: CancellationTokenSource|undefined;
    return new Promise<Token>((resolve, reject) => {
      const dispose = () => {
        cancellationSource = undefined;
        status.dispose();
      };
      cancellationToken.add(() => {
        if (cancellationSource !== undefined) {
          cancellationSource.cancel();
          cancellationSource = undefined;
          status.dispose();
          reject(CANCELED);
        }
      });
      const writeLoginStatus = (
          msg = 'Authorization required.', linkMessage = 'Request authorization.') => {
        status.setText(msg + ' ');
        if (this.retry) {
          let button = document.createElement('button');
          button.textContent = linkMessage;
          status.element.appendChild(button);
          button.addEventListener('click', this.retry);
        }
        status.setVisible(true);
      }
      let authServer = this.authServer;
      const login = () => {
        if (cancellationSource !== undefined) {
          cancellationSource.cancel();
        }
        cancellationSource = new CancellationTokenSource();
        writeLoginStatus('Waiting for authorization...', 'Retry');
        this.getAuthToken(authServer, cancellationSource)
            .then(
                token => {
                  if (cancellationSource !== undefined) {
                    dispose();
                    resolve(token);
                  }
                },
                reason => {
                  if (cancellationSource !== undefined) {
                    cancellationSource = undefined;
                    writeLoginStatus(`Authorization failed: ${reason}.`, 'Retry');
                  }
                });
      }
      login();
    });
  });
}