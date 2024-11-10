/**
 * @file Utility functions to interact with the Hugging Face Hub (https://huggingface.co/models)
 * 
 * @module utils/hub
 */

import fs from 'fs';
import path from 'path';
import { Buffer } from 'react-native-buffer';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { InteractionManager } from 'react-native';

import { env } from '../core/env.ts';
import { dispatchCallback } from './core.ts';


const IS_REACT_NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';

console.log('React Native environment detected:', IS_REACT_NATIVE);

/**
 * @typedef {Object} PretrainedOptions Options for loading a pretrained model.     
 * @property {boolean?} [quantized=true] Whether to load the 8-bit quantized version of the model (only applicable when loading model files).
 * @property {function} [progress_callback=null] If specified, this function will be called during model construction, to provide the user with progress updates.
 * @property {Object} [config=null] Configuration for the model to use instead of an automatically loaded configuration. Configuration can be automatically loaded when:
 * - The model is a model provided by the library (loaded with the *model id* string of a pretrained model).
 * - The model is loaded by supplying a local directory as `pretrained_model_name_or_path` and a configuration JSON file named *config.json* is found in the directory.
 * @property {string} [cache_dir=null] Path to a directory in which a downloaded pretrained model configuration should be cached if the standard cache should not be used.
 * @property {boolean} [local_files_only=false] Whether or not to only look at local files (e.g., not try downloading the model).
 * @property {string} [revision='main'] The specific model version to use. It can be a branch name, a tag name, or a commit id,
 * since we use a git-based system for storing models and other artifacts on huggingface.co, so `revision` can be any identifier allowed by git.
 * NOTE: This setting is ignored for local requests.
 * @property {string} [model_file_name=null] If specified, load the model with this name (excluding the .onnx suffix). Currently only valid for encoder- or decoder-only models.
 * @property {Object} [session_options={}] Options to pass to the backend session.
 */

/**
 * Mapping from file extensions to MIME types.
 */
const CONTENT_TYPE_MAP = {
    'txt': 'text/plain',
    'html': 'text/html',
    'css': 'text/css',
    'js': 'text/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
}

/**
 * Returns the MIME type for the file specified by the given path.
 * 
 * @param {string|URL} path The path to the file.
 * @returns {string} The MIME type for the file specified by the given path.
 */
function getMIME(path) {
    const extension = String(path).split('.').pop().toLowerCase();
    return CONTENT_TYPE_MAP[extension] ?? 'application/octet-stream';
}

/**
 * @property {boolean} ok
 * @property {number} status
 * @property {string} statusText
 * @property {Headers} headers
 * @property {string} url
 * @property {string} filePath
 * @property {ReadableStream<Uint8Array>|null} body
 */
class FileResponse {
    /**
     * Creates a new `FileResponse` object.
     * @param {string|URL} filePath
     */
    constructor(filePath) {
        this.url = filePath;
        this.filePath = filePath;
        this.headers = new Map();
        this.ok = false;
        this.status = 0;
        this.statusText = '';
        this._body = null;
    }

    static async create(filePath) {
        console.log('Creating FileResponse for:', filePath);
        let response = new FileResponse(filePath);
        
        if (IS_REACT_NATIVE) {
            try {
                console.log(`Attempting to create FileResponse for: ${filePath}`);
                const exists = await RNFS.exists(filePath);
                response.ok = exists;
                if (exists) {
                    response.status = 200;
                    response.statusText = 'OK';
                    const fileStats = await RNFS.stat(filePath);
                    response.headers.set('content-length', String(fileStats.size));
                    response.headers.set('content-type', getMIMEType(filePath));
                    console.log(`File exists: ${filePath}, Size: ${fileStats.size}`);
                } else {
                    response.status = 404;
                    response.statusText = 'Not Found';
                    console.log(`File not found: ${filePath}`);
                }
            } catch (error) {
                console.error(`Error in FileResponse.create for ${filePath}:`, error);
                response.status = 500;
                response.statusText = 'Internal Server Error';
            }
        } else {
            console.log('Checking if file exists in Node.js:', response.filePath);
            response.ok = fs.existsSync(response.filePath);
            if (response.ok) {
                response.status = 200;
                response.statusText = 'OK';

                let stats = fs.statSync(response.filePath);
                response.headers.set('content-length', stats.size.toString());
                response.headers.set('content-type', getMIME(response.filePath));
            } else {
                console.log('File not found:', response.filePath);
                response.status = 404;
                response.statusText = 'Not Found';
            }
        }
        return response;
    }

    /**
     * Clone the current FileResponse object.
     * @returns {FileResponse} A new FileResponse object with the same properties as the current object.
     */
    clone() {
        console.log('Cloning file response:', this.filePath);
        let response = new FileResponse(this.filePath);
        response.ok = this.ok;
        response.status = this.status;
        response.statusText = this.statusText;
        response.headers = new Map(this.headers);
        return response;
    }

    get bodyUsed() {
        console.log('bodyUsed:', this._body !== null);
        return this._body !== null;
    }

    get body() {
        if (IS_REACT_NATIVE) throw new Error('`body` is not supported in React Native.');
        const self = this;
        console.log('Getting body:', this.filePath);
        this._body ??= new ReadableStream({
            start(controller) {
                self.arrayBuffer().then(buffer => {
                    controller.enqueue(new Uint8Array(buffer));
                    controller.close();
                });
            }
        });
        return this._body;
    }

    /**
     * Reads the contents of the file specified by the filePath property and returns a Promise that
     * resolves with an ArrayBuffer containing the file's contents.
     * @returns {Promise<ArrayBuffer>} A Promise that resolves with an ArrayBuffer containing the file's contents.
     * @throws {Error} If the file cannot be read.
     */
    async arrayBuffer() {
        if (IS_REACT_NATIVE) {
            try {
                const content = await RNFS.readFile(this.filePath, 'base64');
                return Buffer.from(content, 'base64').buffer;
            } catch (error) {
                console.error('Error in FileResponse.arrayBuffer:', error);
                throw error;
            }
        } else {
            const data = await fs.promises.readFile(this.filePath);
            return data.buffer;
        }
    }

    /**
     * Reads the contents of the file specified by the filePath property and returns a Promise that
     * resolves with a Blob containing the file's contents.
     * @returns {Promise<Blob>} A Promise that resolves with a Blob containing the file's contents.
     * @throws {Error} If the file cannot be read.
     */
    async blob() {
        if (IS_REACT_NATIVE) {
            try {
                const content = await RNFS.readFile(this.filePath, 'base64');
                return new Blob([Buffer.from(content, 'base64')], { type: this.headers.get('content-type') });
            } catch (error) {
                console.error('Error in FileResponse.blob:', error);
                throw error;
            }
        } else {
            const data = await fs.promises.readFile(this.filePath);
            return new Blob([data], { type: this.headers.get('content-type') });
        }
    }

    /**
     * Reads the contents of the file specified by the filePath property and returns a Promise that
     * resolves with a string containing the file's contents.
     * @returns {Promise<string>} A Promise that resolves with a string containing the file's contents.
     * @throws {Error} If the file cannot be read.
     */
    async text() {
        if (IS_REACT_NATIVE) {
            try {
                return await RNFS.readFile(this.filePath, 'utf8');
            } catch (error) {
                console.error('Error in FileResponse.text:', error);
                throw error;
            }
        } else {
            const data = await fs.promises.readFile(this.filePath, 'utf8');
            return data;
        }
    }

    /**
     * Reads the contents of the file specified by the filePath property and returns a Promise that
     * resolves with a parsed JavaScript object containing the file's contents.
     * 
     * @returns {Promise<Object>} A Promise that resolves with a parsed JavaScript object containing the file's contents.
     * @throws {Error} If the file cannot be read.
     */
    async json() {
        const content = await this.text();
        return JSON.parse(content);
    }
}

function getMIMEType(filePath) {
    const extension = filePath.split('.').pop().toLowerCase();
    const MIME_TYPES = {
        'json': 'application/json',
        'txt': 'text/plain',
        // Add other MIME types as needed
    };
    return MIME_TYPES[extension] || 'application/octet-stream';
}

/**
 * Parse HTTP headers.
 * 
 * @function parseHeaders
 * @param {string} rawHeaders
 * @returns {Headers}
 */
function parseHeaders(rawHeaders) {
    const headers = new Headers();
    const preProcessedHeaders = rawHeaders.replace(/\r?\n[\t ]+/g, ' ');
    preProcessedHeaders.split(/\r?\n/).forEach((line) => {
        const parts = line.split(':');
        const key = parts.shift().trim();
        if (key) {
            const value = parts.join(':').trim();
            headers.append(key, value);
        }
    });
    return headers;
}

/**
 * Makes an binary fetch request using the XHR API.
 * 
 * @function fetchBinary
 * @param {string|URL} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
function fetchBinaryImpl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const request = new Request(url, options);
        const xhr = new XMLHttpRequest();

        xhr.onload = () => {
            const reqOptions = {
                status: xhr.status,
                statusText: xhr.statusText,
                headers: parseHeaders(xhr.getAllResponseHeaders() || ''),
                url: '',
            };
            reqOptions.url = 'responseURL' in xhr ?
                xhr.responseURL :
                reqOptions.headers.get('x-request-url');

            resolve(new Response(xhr.response, reqOptions));
        };

        xhr.onerror = () => reject(new TypeError('Network request failed'));
        xhr.ontimeout = () => reject(new TypeError('Request timeout'));

        xhr.open(request.method, request.url, true);

        if (request.credentials === 'include') {
            xhr.withCredentials = true;
        } else if (request.credentials === 'omit') {
            xhr.withCredentials = false;
        }

        xhr.responseType = 'arraybuffer';

        request.headers.forEach((value, name) => {
            xhr.setRequestHeader(name, value);
        });

        xhr.send(request._bodyInit ?? null);
    });
}

export const fetchBinary = IS_REACT_NATIVE ? fetchBinaryImpl : fetch;

/**
 * Determines whether the given string is a valid URL.
 * @param {string|URL} string The string to test for validity as an URL.
 * @param {string[]} [protocols=null] A list of valid protocols. If specified, the protocol must be in this list.
 * @param {string[]} [validHosts=null] A list of valid hostnames. If specified, the URL's hostname must be in this list.
 * @returns {boolean} True if the string is a valid URL, false otherwise.
 */
function isValidUrl(string, protocols = null, validHosts = null) {
    if (IS_REACT_NATIVE) {
        if (protocols && !protocols.some((protocol) => string.startsWith(protocol)))
            return false;
        if (validHosts) {
            const match = string.match(/^(\w+\:)\/\/(([^:\/?#]*)(?:\:([0-9]+))?)/);
            if (!match || !validHosts.includes(match[3]))
              return false;
        }
    } else {
        let url;
        try {
            url = new URL(string);
        } catch (_) {
            return false;
        }
        if (protocols && !protocols.includes(url.protocol)) {
            return false;
        }
        if (validHosts && !validHosts.includes(url.hostname)) {
            return false;
        }
    }
    return true;
}

/**
 * Helper function to download a file.
 *
 * @param {URL|string} fromUrl The URL/path of the file to download.
 * @param {string} toFile The path of the file to download to.
 * @param {function} progress_callback A callback function that is called with progress information.
 * @returns {Promise<void>}
 */
export async function downloadFile(fromUrl, toFile, progress_callback) {
    console.log(`Downloading file: ${fromUrl} to ${toFile}`);
    if (IS_REACT_NATIVE) {
        try {

            await ensureCacheDirectoryExists(path.dirname(toFile));
            const result = await RNFS.downloadFile({
                fromUrl,
                toFile,
                headers: {
                  'User-Agent': 'DocuLens-App',
                },
                background: true,
                begin: (res) => {
                  console.log('Download begun', res);
                },
                progress: (res) => {
                  const progress = (res.bytesWritten / res.contentLength) * 100;
                  console.log(`Downloaded ${progress.toFixed(2)}%`);
                },
              }).promise;
            

            if (result.statusCode === 200) {
                console.log(`File downloaded successfully: ${toFile}`);
                return new FileResponse(toFile);
            } else {
                throw new Error(`Download failed with status code ${result.statusCode}`);
            }
        } catch (error) {
            console.error('Error downloading file:', error);
            throw error;
        }
    } else {
        // Non-React Native environment (browser or Node.js)
        await fs.promises.mkdir(path.dirname(toFile), { recursive: true });
        const response = await fetch(fromUrl);
        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.statusText}`);
        }
        const reader = response.body.getReader();
        const writer = fs.createWriteStream(toFile);
        let received = 0;
        const contentLength = Number(response.headers.get('content-length'));
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            writer.write(value);
            received += value.length;
            progress_callback({
                progress: contentLength ? received / contentLength : 0,
                loaded: received,
                total: contentLength,
            });
        }
        writer.end();
    }
}

/**
 * Helper function to get a file, using either the Fetch API or FileSystem API.
 *
 * @param {URL|string} urlOrPath The URL/path of the file to get.
 * @returns {Promise<FileResponse|Response>} A promise that resolves to a FileResponse object (if the file is retrieved using the FileSystem API), or a Response object (if the file is retrieved using the Fetch API).
 */
export async function getFile(filePath) {
    const startTime = Date.now();
    console.log('getFile started for:', filePath);

    try {
        const statStart = Date.now();
        const fileInfo = await RNFS.stat(filePath);
        console.log(`RNFS.stat took ${Date.now() - statStart}ms`);

        if (fileInfo.isFile()) {
            const readStart = Date.now();
            const content = await RNFS.readFile(filePath, 'base64');
            console.log(`RNFS.readFile took ${Date.now() - readStart}ms for ${content.length} bytes`);

            const bufferStart = Date.now();
            const buffer = Buffer.from(content, 'base64');
            console.log(`Buffer.from took ${Date.now() - bufferStart}ms`);

            console.log(`Total getFile time: ${Date.now() - startTime}ms`);
            return {
                status: 200,
                url: filePath,
                headers: new Map([['Content-Type', getMIME(filePath)]]),
                arrayBuffer: async () => buffer
            };
        } else {
            console.log(`${filePath} is not a file. Total time: ${Date.now() - startTime}ms`);
            return { status: 404 };
        }
    } catch (error) {
        console.error(`Error in getFile: ${error}. Total time: ${Date.now() - startTime}ms`);
        return { status: 404 };
    }
}

const ERROR_MAPPING = {
    // 4xx errors (https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#client_error_responses)
    400: 'Bad request error occurred while trying to load file',
    401: 'Unauthorized access to file',
    403: 'Forbidden access to file',
    404: 'Could not locate file',
    408: 'Request timeout error occurred while trying to load file',

    // 5xx errors (https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#server_error_responses)
    500: 'Internal server error error occurred while trying to load file',
    502: 'Bad gateway error occurred while trying to load file',
    503: 'Service unavailable error occurred while trying to load file',
    504: 'Gateway timeout error occurred while trying to load file',
}
/**
 * Helper method to handle fatal errors that occur while trying to load a file from the Hugging Face Hub.
 * @param {number} status The HTTP status code of the error.
 * @param {string} remoteURL The URL of the file that could not be loaded.
 * @param {boolean} fatal Whether to raise an error if the file could not be loaded.
 * @returns {null} Returns `null` if `fatal = true`.
 * @throws {Error} If `fatal = false`.
 */
function handleError(status, remoteURL, fatal) {
    if (!fatal) {
        // File was not loaded correctly, but it is optional.
        // TODO in future, cache the response?
        return null;
    }

    const message = ERROR_MAPPING[status] ?? `Error (${status}) occurred while trying to load file`;
    throw Error(`${message}: "${remoteURL}".`);
}

class FileCache {
    /**
     * Instantiate a `FileCache` object.
     * @param {string} path 
     */
    constructor(path) {
        this.path = path;
    }

    /**
     * Checks whether the given request is in the cache.
     * @param {string} request 
     * @returns {Promise<FileResponse | undefined>}
     */
    async match(request) {

        let filePath = path.join(this.path, request);
        let file = await FileResponse.create(filePath);

        if (file.ok) {
            return file;
        } else {
            return undefined;
        }
    }

    /**
     * Adds the given response to the cache.
     * @param {string} request 
     * @param {Response|FileResponse} response 
     * @returns {Promise<void>}
     */
    async put(request, response) {
        const buffer = Buffer.from(await response.arrayBuffer());

        let outputPath = path.join(this.path, request);

        try {
            if (IS_REACT_NATIVE) {
                await fs.mkdir(path.dirname(outputPath));
                await fs.writeFile(outputPath, buffer.toString('base64'), 'base64');
            } else {
                await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
                await fs.promises.writeFile(outputPath, buffer);
            }
        } catch (err) {
            console.warn('An error occurred while writing the file to cache:', err)
        }
    }

    // TODO add the rest?
    // addAll(requests: RequestInfo[]): Promise<void>;
    // delete(request: RequestInfo | URL, options?: CacheQueryOptions): Promise<boolean>;
    // keys(request?: RequestInfo | URL, options?: CacheQueryOptions): Promise<ReadonlyArray<Request>>;
    // match(request: RequestInfo | URL, options?: CacheQueryOptions): Promise<Response | undefined>;
    // matchAll(request?: RequestInfo | URL, options?: CacheQueryOptions): Promise<ReadonlyArray<Response>>;
}

/**
 * 
 * @param {FileCache|Cache} cache The cache to search
 * @param {string[]} names The names of the item to search for
 * @returns {Promise<FileResponse|Response|undefined>} The item from the cache, or undefined if not found.
 */
async function tryCache(cache, ...names) {
    for (let name of names) {
        try {
            let result = await cache.match(name);
            if (result) return result;
        } catch (e) {
            continue;
        }
    }
    return undefined;
}

/**
 * 
 * Retrieves a file from either a remote URL using the Fetch API or from the local file system using the FileSystem API.
 * If the filesystem is available and `env.useCache = true`, the file will be downloaded and cached.
 * 
 * @param {string} path_or_repo_id This can be either:
 * - a string, the *model id* of a model repo on huggingface.co.
 * - a path to a *directory* potentially containing the file.
 * @param {string} filename The name of the file to locate in `path_or_repo`.
 * @param {boolean} [fatal=true] Whether to throw an error if the file is not found.
 * @param {PretrainedOptions} [options] An object containing optional parameters.
 * 
 * @throws Will throw an error if the file is not found and `fatal` is true.
 * @returns {Promise<Uint8Array>} A Promise that resolves with the file content as a buffer.
 */
export async function getModelFile(path_or_repo_id, filename, fatal = true, options = {}) {
  console.log(`Attempting to get model file: ${filename}`);
  
  const localPath = `${RNFS.DocumentDirectoryPath}/models/${path_or_repo_id}/${filename}`;
  const remoteURL = `https://huggingface.co/${path_or_repo_id}/resolve/main/${filename}`;

  try {
    // Check if file exists locally
    const exists = await RNFS.exists(localPath);
    if (exists) {
      console.log(`File exists locally: ${localPath}`);
      // Use InteractionManager to avoid blocking the UI thread
      return await new Promise((resolve) => {
        InteractionManager.runAfterInteractions(async () => {
          const content = await readFile(localPath, filename);
          console.log(`Local file ${filename} loaded successfully`);
          resolve(content);
        });
      });
    }

    // If not, download the file
    console.log(`File not found locally. Downloading from: ${remoteURL}`);
    await downloadFile(remoteURL, localPath, (progress) => {
      console.log(`Downloading ${filename}: ${Math.round(progress * 100)}% complete`);
    });
    console.log(`File ${filename} downloaded successfully to: ${localPath}`);

    // Use InteractionManager to avoid blocking the UI thread
    return await new Promise((resolve) => {
      InteractionManager.runAfterInteractions(async () => {
        const content = await readFile(localPath, filename);
        console.log(`Downloaded file ${filename} loaded successfully`);
        resolve(content);
      });
    });
  } catch (error) {
    console.error(`Error in getModelFile for ${filename}:`, error);
    if (fatal) {
      throw error;
    }
    return null;
  }
}

// Helper function to read file content
async function readFile(path, filename) {
  try {
    const content = await RNFS.readFile(path, 'utf8');
    return content;
  } catch (error) {
    console.error(`Error reading file ${filename}:`, error);
    throw error;
  }
}


/**
 * 
 * Retrieves a file from either a remote URL using the Fetch API or from the local file system using the FileSystem API.
 * If the filesystem is available and `env.useCache = true`, the file will be downloaded and cached.
 * 
 * @param {string} path_or_repo_id This can be either:
 * - a string, the *model id* of a model repo on huggingface.co.
 * - a path to a *directory* potentially containing the file.
 * @param {string} filename The name of the file to locate in `path_or_repo`.
 * @param {boolean} [fatal=true] Whether to throw an error if the file is not found.
 * @param {PretrainedOptions} [options] An object containing optional parameters.
 * 
 * @throws Will throw an error if the file is not found and `fatal` is true.
 * @returns {Promise<string>} A Promise that resolves with the file content as a buffer.
 */
export async function getModelPath(path_or_repo_id, filename, fatal = true, options = {}) {

    if (!env.allowLocalModels) {
        // User has disabled local models, so we just make sure other settings are correct.

        throw Error("Invalid configuration detected: local models are disabled (`env.allowLocalModels=false`) but you have requested to load a local model.")
    }

    // Initiate file retrieval
    console.log('dis patchinnnnnnng')
    dispatchCallback(options.progress_callback, {
        status: 'initiate',
        name: path_or_repo_id,
        file: filename
    })

    // First, check if the a caching backend is available
    // If no caching mechanism available, will download the file every time
    let cache;

    if (!cache && env.useFSCache) {
        // TODO throw error if not available

        // If `cache_dir` is not specified, use the default cache directory
        cache = new FileCache(options.cache_dir ?? env.cacheDir);
    }

    if (!cache && env.useCustomCache) {
        throw Error('Custom cache not supported for `getModelPath`.')
    }

    const revision = options.revision ?? 'main';

    let requestURL = pathJoin(path_or_repo_id, filename);
    let localPath = pathJoin(env.localModelPath, requestURL);

    let remoteURL = pathJoin(
        env.remoteHost,
        env.remotePathTemplate
            .replaceAll('{model}', path_or_repo_id)
            .replaceAll('{revision}', encodeURIComponent(revision)),
        filename
    );

    // Choose cache key for filesystem cache
    // When using the main revision (default), we use the request URL as the cache key.
    // If a specific revision is requested, we account for this in the cache key.
    let fsCacheKey = revision === 'main' ? requestURL : pathJoin(path_or_repo_id, revision, filename);

    /** @type {string} */
    let cacheKey;
    let proposedCacheKey = cache instanceof FileCache ? fsCacheKey : remoteURL;

    /** @type {Response|FileResponse|undefined} */
    let response;

    if (cache) {
        // A caching system is available, so we try to get the file from it.
        //  1. We first try to get from cache using the local path. In some environments (like deno),
        //     non-URL cache keys are not allowed. In these cases, `response` will be undefined.
        //  2. If no response is found, we try to get from cache using the remote URL or file system cache.
        response = await tryCache(cache, localPath, proposedCacheKey);
    }

    if (response === undefined) {
        // Caching not available, or file is not cached, so we perform the request
        console.log("get model path")
        // Accessing local models is enabled, so we try to get the file locally.
        // If request is a valid HTTP URL, we skip the local file check. Otherwise, we try to get the file locally.
        const isURL = isValidUrl(requestURL, ['http:', 'https:']);
        if (!isURL) {
            try {
                console.log('Attempting to load file from:', localPath);
                response = await getFile(localPath);
                console.log('GOT RESPONSE FAM');
                cacheKey = localPath; // Update the cache key to be the local path
            } catch (e) {
                // Something went wrong while trying to get the file locally.
                // NOTE: error handling is done in the next step (since `response` will be undefined)
                console.warn(`Unable to load from local path "${localPath}": "${e}"`);
            }
        } else if (options.local_files_only) {
            throw new Error(`\`local_files_only=true\`, but attempted to load a remote file from: ${requestURL}.`);
        } else if (!env.allowRemoteModels) {
            throw new Error(`\`env.allowRemoteModels=false\`, but attempted to load a remote file from: ${requestURL}.`);
        }

        if (response === undefined || response.status === 404) {
            // File not found locally. This means either:
            // - The user has disabled local file access (`env.allowLocalModels=false`)
            // - the path is a valid HTTP url (`response === undefined`)
            // - the path is not a valid HTTP url and the file is not present on the file system or local server (`response.status === 404`)

            if (options.local_files_only || !env.allowRemoteModels) {
                // User requested local files only, but the file is not found locally.
                if (fatal) {
                    throw Error(`\`local_files_only=true\` or \`env.allowRemoteModels=false\` and file was not found locally at "${localPath}".`);
                } else {
                    // File not found, but this file is optional.
                    // TODO in future, cache the response?
                    return null;
                }
            }

            // Start downloading
            dispatchCallback(options.progress_callback, {
                status: 'download',
                name: path_or_repo_id,
                file: filename
            })
        
            const progressInfo = {
                status: 'progress',
                name: path_or_repo_id,
                file: filename
            }
            console.log("cache path")
            const cachePath = path.join(options.cache_dir ?? env.cacheDir, proposedCacheKey);
            await downloadFile(remoteURL, cachePath, data => {
                dispatchCallback(options.progress_callback, {
                    ...progressInfo,
                    ...data,
                })
            });
            console.log("get file")
            response = await getFile(cachePath);
            if (response.status !== 200) {
                return handleError(response.status, remoteURL, fatal);
            }

            dispatchCallback(options.progress_callback, {
                status: 'done',
                name: path_or_repo_id,
                file: filename
            });
        }
    }

    if (response) {
            console.log('Response :', response);
        console.log('Response status:', response.status);
        console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    }

    return IS_REACT_NATIVE ? response.url : response.filePath;
}

/**
 * Fetches a JSON file from a given path and file name.
 *
 * @param {string} modelPath The path to the directory containing the file.
 * @param {string} fileName The name of the file to fetch.
 * @param {boolean} [fatal=true] Whether to throw an error if the file is not found.
 * @param {PretrainedOptions} [options] An object containing optional parameters.
 * @returns {Promise<Object>} The JSON data parsed into a JavaScript object.
 * @throws Will throw an error if the file is not found and `fatal` is true.
 */
export async function getModelJSON(modelPath, fileName, fatal = true, options = {}) {
    console.log('getModelJSON called with modelPath:', modelPath, 'fileName:', fileName);
    
    let buffer = await getModelFile(modelPath, fileName, fatal, options);
    console.log('buffer :', buffer.length);
    if (buffer === null) {
        // Return empty object
        return {}
    }

    if (IS_REACT_NATIVE) return JSON.parse(Buffer.from(buffer));

    let decoder = new TextDecoder('utf-8');
    let jsonData = decoder.decode(buffer);
    return JSON.parse(jsonData);
}

/**
 * Read and track progress when reading a Response object
 *
 * @param {any} response The Response object to read
 * @param {function} progress_callback The function to call with progress updates
 * @returns {Promise<Uint8Array>} A Promise that resolves with the Uint8Array buffer
 */
async function readResponse(response, progress_callback) {
    if (IS_REACT_NATIVE) {
        return await response.arrayBuffer();
    }

    // Read and track progress when reading a Response object
    const contentLength = response.headers.get('Content-Length');
    if (contentLength === null) {
        console.warn('Unable to determine content-length from response headers. Will expand buffer when needed.')
    }
    let total = parseInt(contentLength ?? '0');
    let buffer = new Uint8Array(total);
    let loaded = 0;

    const reader = response.body.getReader();
    async function read() {
        const { done, value } = await reader.read();
        if (done) return;

        let newLoaded = loaded + value.length;
        if (newLoaded > total) {
            total = newLoaded;

            // Adding the new data will overflow buffer.
            // In this case, we extend the buffer
            let newBuffer = new Uint8Array(total);

            // copy contents
            newBuffer.set(buffer);

            buffer = newBuffer;
        }
        buffer.set(value, loaded)
        loaded = newLoaded;

        const progress = (loaded / total) * 100;

        // Call your function here
        progress_callback({
            progress: progress,
            loaded: loaded,
            total: total,
        })

        return read();
    }

    // Actually read
    await read();

    return buffer;
}

/**
 * Joins multiple parts of a path into a single path, while handling leading and trailing slashes.
 *
 * @param {...string} parts Multiple parts of a path.
 * @returns {string} A string representing the joined path.
 */
function pathJoin(...parts) {
    // https://stackoverflow.com/a/55142565
    parts = parts.map((part, index) => {
        if (index) {
            part = part.replace(new RegExp('^/'), '');
        }
        if (index !== parts.length - 1) {
            part = part.replace(new RegExp('/$'), '');
        }
        return part;
    })
    return parts.join('/');
}

console.log('Environment configuration:', {
    allowLocalModels: env.allowLocalModels,
    allowRemoteModels: env.allowRemoteModels,
    useCache: env.useCache,
    cacheDir: env.cacheDir,
    localModelPath: env.localModelPath
});

export const ensureCacheDirectoryExists = async (cacheDir) => {
  try {
    const exists = await RNFS.exists(cacheDir);
    if (!exists) {
      await RNFS.mkdir(cacheDir);
    }
  } catch (error) {
    console.error('Error ensuring cache directory exists:', error);
  }
};

function normalizeFilePath(path) {
  if (!path) {
    throw new Error('Path is required for normalization');
  }
  // Remove any leading slash
  return path.replace(/^\//, '');
}



function constructRemoteURL(localPath) {
  const parts = localPath.split('/');
  const modelName = parts[parts.length - 4] + '/' + parts[parts.length - 3];
  const fileName = parts.slice(-2).join('/');
  return `https://huggingface.co/${modelName}/resolve/main/${fileName}`;
}

