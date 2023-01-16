import { Server } from "../models/server";
import { getAccessToken, msalEnabled } from "../msal/MsalAuthProvider";

import AuthorizationService, { AuthorizationStatus } from "./credentialsService";

export class ApiClient {
  private static async getCommonHeaders(targetServer: Server = undefined, sourceServer: Server = undefined): Promise<HeadersInit> {
    const authorizationHeader = await this.getAuthorizationHeader();
    return {
      "Content-Type": "application/json",
      ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
      "WitsmlTargetServer": this.getServerHeader(targetServer),
      "WitsmlSourceServer": this.getServerHeader(sourceServer)
    };
  }

  private static getServerHeader(server: Server | undefined): string {
    return server?.url == null ? "" : server.url.toString();
  }

  public static async getAuthorizationHeader(): Promise<string | null> {
    if (msalEnabled) {
      const token = await getAccessToken([`${process.env.NEXT_PUBLIC_AZURE_AD_SCOPE_API}`]);
      return `Bearer ${token}`;
    }
    return null;
  }

  public static async get(pathName: string, abortSignal: AbortSignal | null = null, server = AuthorizationService.selectedServer): Promise<Response> {
    const requestInit: RequestInit = {
      signal: abortSignal,
      headers: await ApiClient.getCommonHeaders(server),
      credentials: "include"
    };

    return ApiClient.runHttpRequest(pathName, requestInit, server);
  }

  public static async post(
    pathName: string,
    body: string,
    abortSignal: AbortSignal | null = null,
    targetServer = AuthorizationService.selectedServer,
    sourceServer = AuthorizationService.sourceServer
  ): Promise<Response> {
    const requestInit: RequestInit = {
      signal: abortSignal,
      method: "POST",
      body: body,
      headers: await ApiClient.getCommonHeaders(targetServer, sourceServer),
      credentials: "include"
    };
    return ApiClient.runHttpRequest(pathName, requestInit, targetServer, sourceServer);
  }

  public static async patch(pathName: string, body: string, abortSignal: AbortSignal | null = null): Promise<Response> {
    const requestInit: RequestInit = {
      signal: abortSignal,
      method: "PATCH",
      body: body,
      headers: await ApiClient.getCommonHeaders(),
      credentials: "include"
    };

    return ApiClient.runHttpRequest(pathName, requestInit);
  }

  public static async delete(pathName: string, abortSignal: AbortSignal | null = null): Promise<Response> {
    const requestInit: RequestInit = {
      signal: abortSignal,
      method: "DELETE",
      headers: await ApiClient.getCommonHeaders(),
      credentials: "include"
    };

    return ApiClient.runHttpRequest(pathName, requestInit);
  }

  public static runHttpRequest(pathName: string, requestInit: RequestInit, targetServer: Server = undefined, sourceServer: Server = undefined, rerun = true) {
    return new Promise<Response>((resolve, reject) => {
      if (!("Authorization" in requestInit.headers)) {
        if (msalEnabled) {
          reject("Not authorized");
        }
      }
      const url = new URL(getBasePathName() + pathName, getBaseUrl());
      this.fetchWithRerun(url, requestInit, targetServer, sourceServer, rerun, resolve, reject);
    });
  }

  private static fetchWithRerun(
    url: URL,
    requestInit: RequestInit,
    targetServer: Server,
    sourceServer: Server,
    rerun: boolean,
    resolve: (value: Response | PromiseLike<Response>) => void,
    reject: (reason?: any) => void
  ) {
    fetch(url.toString(), requestInit)
      .then((response) => {
        if (response.status == 401 && rerun) {
          this.handleUnauthorized(url, requestInit, targetServer, sourceServer, response, resolve, reject);
        } else {
          resolve(response);
        }
      })
      .catch((error) => {
        if (error.name === "AbortError") {
          return;
        }
        reject(error);
      });
  }

  private static async handleUnauthorized(
    url: URL,
    requestInit: RequestInit,
    targetServer: Server,
    sourceServer: Server,
    originalResponse: Response,
    resolve: (value: Response | PromiseLike<Response>) => void,
    reject: (reason?: any) => void
  ) {
    const result = await originalResponse.clone().json();
    const server: "Target" | "Source" | undefined = result.server;
    const serverToAuthorize = server == "Source" ? sourceServer : targetServer;
    if (serverToAuthorize == null) {
      resolve(originalResponse);
      return;
    }
    const unsub = AuthorizationService.onAuthorizationChangeEvent.subscribe(async (authorizationState) => {
      if (authorizationState.status == AuthorizationStatus.Cancel) {
        unsub();
        resolve(originalResponse);
      } else if (authorizationState.status == AuthorizationStatus.Authorized && authorizationState.server.id == serverToAuthorize.id) {
        unsub();
        this.fetchWithRerun(url, requestInit, targetServer, sourceServer, true, resolve, reject);
      }
    });
    AuthorizationService.onAuthorizationChangeDispatch({ server: serverToAuthorize, status: AuthorizationStatus.Unauthorized });
  }
}

function getBasePathName(): string {
  const basePathName = getBaseUrl().pathname;
  return basePathName !== "/" ? basePathName : "";
}

export function getBaseUrl(): URL {
  let baseUrl: URL;
  try {
    const configuredUrl = process.env.WITSMLEXPLORER_API_URL;
    if (configuredUrl && configuredUrl.length > 0) {
      baseUrl = new URL(configuredUrl);
    } else {
      const protocol = window.location.protocol.slice(0, -1);
      const host = window.location.hostname;
      const port = window.location.port === "3000" ? ":5000" : "";
      baseUrl = new URL(`${protocol}://${host}${port}`);
    }
  } catch (e) {
    baseUrl = new URL("http://localhost");
  }
  return baseUrl;
}

export function truncateAbortHandler(e: Error): void {
  if (e.name === "AbortError") {
    return;
  }
  throw e;
}
