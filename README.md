# 🤗 Transformers React Native

Run Hugging Face Transformers directly in React Native! This library provides a native port of transformers.js, optimized for mobile environments.

## Installation

```bash
yarn add @aneshmida/transformers-react-native
```


## Features

- 🚀 Run ML models directly on device
- 📱 Optimized for React Native
- 🔄 Automatic model caching
- 💾 Efficient memory management
- ⚡ ONNX runtime optimization

## Quick Start

```javascript
import { pipeline } from '@aneshmida/transformers-react-native';

// Sentiment Analysis
const classifier = await pipeline('sentiment-analysis');
const result = await classifier('I love transformers!');
console.log(result);
// [{ label: 'POSITIVE', score: 0.999 }]

// Text Generation
const generator = await pipeline('text-generation');
const text = await generator('The cat was');
console.log(text);
// [{ generated_text: 'The cat was sitting on the windowsill...' }]
```


## Supported Tasks

- Text Classification
- Token Classification
- Question Answering
- Text Generation
- Translation
- Summarization
- Fill-Mask
- Zero-shot Classification

## API Reference

### Pipeline

The main interface to use pre-trained models:

```javascript
const pipeline = await pipeline(task, {
    model: string,              // Model identifier (optional)
    quantized: boolean,         // Use quantized model (default: true)
    cache_dir: string,         // Custom cache directory (optional)
    local_files_only: boolean  // Use only cached models (default: false)
});
```


### Environment Configuration

```javascript
import { env } from '@aneshmida/transformers-react-native';

// Configure model storage
env.localModelPath = '/custom/path/to/models';
env.cacheDir = '/custom/path/to/cache';

// Configure runtime
env.allowRemoteModels = false;  // Disable remote model loading
```


## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © [Anes Hmida]