/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as lib_bridge from "../lib/bridge.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_home from "../lib/home.js";
import type * as lib_inbox from "../lib/inbox.js";
import type * as lib_sendvise from "../lib/sendvise.js";
import type * as lib_slack from "../lib/slack.js";
import type * as runtime from "../runtime.js";
import type * as sendviseHttp from "../sendviseHttp.js";
import type * as slackHttp from "../slackHttp.js";
import type * as store from "../store.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  http: typeof http;
  jobs: typeof jobs;
  "lib/bridge": typeof lib_bridge;
  "lib/config": typeof lib_config;
  "lib/home": typeof lib_home;
  "lib/inbox": typeof lib_inbox;
  "lib/sendvise": typeof lib_sendvise;
  "lib/slack": typeof lib_slack;
  runtime: typeof runtime;
  sendviseHttp: typeof sendviseHttp;
  slackHttp: typeof slackHttp;
  store: typeof store;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
