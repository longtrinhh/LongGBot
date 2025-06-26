# LongGBot Web Application

A modern web-based AI assistant, featuring multiple AI models for chat and image generation/editing.

## Features

### 🤖 Chat Models
- **Claude Opus 4** - Advanced reasoning and analysis
- **GPT o3 High** - High-performance language model
- **Gemini 2.5 Pro** - Google's latest AI model
- **Perplexity Sonar Deep Research** - Web search capabilities
- **GPT o3 Mini Online** - Fast and efficient model

### 🎨 Image Generation Models
- **Google Imagen 4.0 Ultra** - High-quality image generation
- **Flux 1 kontext max** - Advanced image generation and editing
- **GPT image 1** - OpenAI's image generation
- **Midjourney v7** - Artistic image generation
- **Hidream i1 full** - Creative image generation

### 🖼️ Image Features
- **Image Generation** - Create images from text descriptions
- **Image Editing** - Modify existing images with AI
- **Image Analysis** - Ask questions about uploaded images
- **Multiple Formats** - Support for various image formats

### 💬 Chat Features
- **Conversation History** - Maintains context across sessions
- **Model Switching** - Easy switching between different AI models
- **Real-time Chat** - Instant responses with loading indicators
- **Error Handling** - Graceful error handling and user feedback

## Installation

1. **Clone or navigate to the project directory**

2. **Add API key for LLM model API in config.py file and codes in codes.txt:**

2. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the application:**
   ```bash
   python app.py
   ```

4. **Open your browser and go to:**
   ```
   http://localhost:5000
   ```

## Usage

### Basic Chat
1. Type your message in the chat input
2. Press Enter or click the send button
3. The AI will respond using your selected model

### Changing Models
1. Click "Change Chat Model" in the sidebar
2. Select your preferred model from the list
3. The model will be saved for future conversations

### Image Generation
1. Click "Generate Image" in the sidebar
2. Enter a description of the image you want
3. Select an image generation model
4. Click "Generate" to create the image

### Image Upload and Analysis
1. Click "Upload Image" in the sidebar
2. Choose an image file from your computer
3. Upload the image
4. Ask questions about the image in the chat

### Image Editing
1. Upload an image first
2. Click "Edit Image" in the sidebar
3. Enter instructions for how to edit the image
4. Click "Edit" to modify the image

### Clearing Chat History
1. Click "Clear Chat History" in the sidebar
2. Confirm the action
3. Your conversation history will be reset

## Configuration
All models and settings are configured in `config.py`.
Access Codes are in codes.txt

## File Structure

```
longgbot/
├── app.py                 # Main Flask application
├── config.py             # Configuration and model settings
├── ai_client.py          # AI chat functionality
├── ai_image_client.py    # Image generation and editing
├── shared_context.py     # Conversation history management
├── requirements.txt      # Python dependencies
├── README.md            # This file
├── templates/
│   └── index.html       # Web interface
├── user_contexts.json   # User conversation history (auto-generated)
└── user_models.json     # User model preferences (auto-generated)
```

## Technical Details

### Backend
- **Framework**: Flask (Python)
- **Async Support**: aiohttp for API calls
- **Image Processing**: Pillow for image manipulation
- **Session Management**: Flask sessions for user identification

### Frontend
- **HTML5/CSS3**: Modern, responsive design
- **JavaScript**: Vanilla JS for interactivity
- **UI Framework**: Custom CSS with gradient backgrounds
- **Icons**: Font Awesome for beautiful icons

### API Integration
- **ElectronHub API**: For all AI model interactions
- **Image Generation**: `/v1/images/generations` endpoint
- **Image Editing**: `/v1/images/edits` endpoint
- **Chat Completions**: `/v1/chat/completions` endpoint

## Security Features

- **Session Management**: Secure user session handling
- **Input Validation**: Proper validation of all user inputs
- **Error Handling**: Comprehensive error handling and logging
- **File Upload Security**: Secure image upload handling

## Browser Compatibility

- **Chrome**: Full support
- **Firefox**: Full support
- **Safari**: Full support
- **Edge**: Full support
- **Mobile Browsers**: Responsive design for mobile devices

## Troubleshooting

### Common Issues

1. **Port already in use:**
   - Change the port in `app.py` line: `app.run(debug=True, host='0.0.0.0', port=5001)`

2. **API errors:**
   - Check your internet connection
   - Verify the API key is correct in `config.py`

3. **Image upload issues:**
   - Ensure the image file is not corrupted
   - Check file size (should be under 10MB)
   - Verify the file is a supported image format

4. **Model switching not working:**
   - Check browser console for JavaScript errors
   - Ensure you have write permissions in the directory

### Logs

The application logs all activities. Check the console output for detailed error messages and debugging information.

## Development

To modify the application:

1. **Adding new models**: Edit `config.py` to add new model configurations
2. **UI changes**: Modify `templates/index.html` and the CSS styles
3. **Backend logic**: Update the Python files in the root directory
4. **API endpoints**: Add new routes in `app.py`