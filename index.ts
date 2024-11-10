/**
 * @file Entry point for the Transformers React Native library.
 * Configures the environment for React Native and exports all functionality.
 */

import { Platform } from 'react-native';
import RNFS from 'react-native-fs';

// Configure environment for React Native
const BASE_PATH = RNFS.DocumentDirectoryPath;
const MODELS_PATH = `${BASE_PATH}/models`;
const CACHE_PATH = `${BASE_PATH}/.cache`;

// Ensure required directories exist
Promise.all([
    RNFS.mkdir(MODELS_PATH).catch(() => {}),
    RNFS.mkdir(CACHE_PATH).catch(() => {})
]).then(() => {
    console.log('Transformers.js: Directories initialized');
}).catch(console.error);

// Export everything from the core library
export * from './src/core/env';
export * from './src/core/models';
export * from './src/core/tokenizers';
export * from './src/core/processors';
export * from './src/core/pipelines';

// Export utilities
export * from './src/utils/audio';
export * from './src/utils/image';
export * from './src/utils/tensor';
export * from './src/utils/maths';
export * from './src/utils/hub';



// Configure environment variables for React Native
import { env } from './src/core/env';

// Override default paths
env.localModelPath = MODELS_PATH;
env.cacheDir = CACHE_PATH;

// Configure ONNX runtime for React Native
env.backends.onnx.executionProviders = ['cpu']; // React Native only supports CPU execution
env.backends.onnx.wasm.numThreads = 1; // Disable threading in React Native

// Export environment configuration
export { env };

// Export version information
export const VERSION = '0.1.0';
export const TRANSFORMERS_VERSION = '2.17.2';

// Export platform information
export const IS_REACT_NATIVE = true;
export const PLATFORM = Platform.OS;

console.log(`Transformers React Native v${VERSION} initialized`);
console.log(`Platform: ${PLATFORM}`);
console.log(`Models directory: ${MODELS_PATH}`);
console.log(`Cache directory: ${CACHE_PATH}`);