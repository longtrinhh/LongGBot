# LongGBot Web Application

A modern web-based AI assistant, featuring multiple AI models for chat and image generation/editing.

## Change Log

### V1.3
- **Stop Button**: Added ability to stop AI responses mid-way through streaming
- **GPT-5 Model**: Added GPT-5 with vision support for premium users
- **Enhanced UI**: Stop button replaces send button during streaming for better UX
- **Improved Responsiveness**: Better mobile experience with responsive stop button
- **Dark Mode Support**: Stop button fully supports dark mode theme
- **Backend Integration**: Added cancellation endpoint for future backend improvements

### V1.2
- **Real-time Streaming**: Added streaming support for all chat models with real-time response display
- **Dark Mode Improvements**: Fixed model selector hover text visibility in dark mode
- **New AI Models**: Added Grok 4 model for enhanced AI capabilities
- **Enhanced UI**: Improved streaming experience with proper thinking message removal
- **Better Error Handling**: Enhanced error handling for streaming responses
- **Mobile Optimization**: Improved streaming performance on mobile devices

### V1.1
- Switched conversation storage to Firestore (cloud database)
- Added support for multiple conversations per user (with separation between users)
- Added conversation list modal with create, switch, and delete features
- Limited saved conversations: 10 for premium users, 2 for normal users (oldest auto-deleted)
- Improved sidebar layout and grouping for better UX
- Added confirmation modals for creating and deleting conversations (custom modal, not browser alert)
- All alerts and confirmations now use unified modal style
- Fixed modal overlay issues on mobile (no stuck dark screen)
- Newest conversations always appear at the top of the list
- Various bug fixes and UI polish for mobile and desktop

## Features

### 🤖 Chat Models
- **Claude Opus 4** - Advanced reasoning and analysis
- **GPT o3 High** - High-performance language model
- **Gemini 2.5 Pro** - Google's latest AI model
- **Grok 4** - xAI's latest reasoning model
- **GPT 5** - OpenAI's latest model with vision support
- **DeepSeek R1** - Advanced reasoning model (no image analysis)
- **Meta: Llama 4 Maverick** - Meta's latest multimodal model with vision
- **Microsoft: Phi 4 Multimodal Instruct** - Microsoft's advanced multimodal model
- **Perplexity Sonar Reasoning Pro** - Web search capabilities
- **GPT o3 Mini Online** - Fast and efficient model
- **GPT 4o Mini Search** - Free model with web search capabilities

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
- **Real-time Streaming** - Instant character-by-character response display
- **Response Control** - Stop button to cancel AI responses mid-way
- **Conversation History** - Maintains context across sessions
- **Model Switching** - Easy switching between different AI models
- **Dark Mode Support** - Full dark mode with proper text visibility
- **Error Handling** - Graceful error handling and user feedback
- **Mobile Optimized** - Responsive design for all devices

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

### Stopping AI Responses
1. During streaming, the send button becomes a red stop button
2. Click the stop button to immediately cancel the AI response
3. A "Response stopped by user" message will appear
4. The send button will return to normal state

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
├── app.py                 # Main Flask application with streaming endpoints
├── config.py             # Configuration and model settings
├── ai_client.py          # AI chat functionality with streaming support
├── ai_image_client.py    # Image generation and editing
├── shared_context.py     # Conversation history management with Firestore
├── requirements.txt      # Python dependencies
├── README.md            # This file
├── templates/
│   └── index.html       # Web interface with streaming UI
├── static/
│   └── css/
│       └── style.css    # Styles with dark mode support
├── user_contexts.json   # User conversation history (auto-generated)
└── user_models.json     # User model preferences (auto-generated)
```

## Technical Details

### Backend
- **Framework**: Flask (Python)
- **Async Support**: aiohttp for API calls and streaming
- **Image Processing**: Pillow for image manipulation
- **Session Management**: Flask sessions for user identification
- **Streaming**: Server-Sent Events (SSE) for real-time responses
- **Database**: Firestore for conversation storage

### Frontend
- **HTML5/CSS3**: Modern, responsive design with dark mode support
- **JavaScript**: Vanilla JS for interactivity and streaming
- **UI Framework**: Custom CSS with gradient backgrounds and animations
- **Icons**: Font Awesome for beautiful icons
- **Markdown Rendering**: Real-time markdown parsing for AI responses

### API Integration
- **ElectronHub API**: For all AI model interactions
- **Image Generation**: `/v1/images/generations` endpoint
- **Image Editing**: `/v1/images/edits` endpoint
- **Chat Completions**: `/v1/chat/completions` endpoint with streaming support
- **Streaming**: Real-time response streaming for all models

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

3. **Streaming not working:**
   - Ensure your browser supports Server-Sent Events (SSE)
   - Check that aiohttp is properly installed: `pip install aiohttp`
   - Verify network connectivity for streaming responses

4. **Image upload issues:**
   - Ensure the image file is not corrupted
   - Check file size (should be under 10MB)
   - Verify the file is a supported image format

5. **Model switching not working:**
   - Check browser console for JavaScript errors
   - Ensure you have write permissions in the directory

6. **Dark mode issues:**
   - Clear browser cache and reload the page
   - Check if your browser supports CSS custom properties

### Logs

The application logs all activities. Check the console output for detailed error messages and debugging information.

## Development

To modify the application:

1. **Adding new models**: Edit `config.py` to add new model configurations
2. **UI changes**: Modify `templates/index.html` and the CSS styles
3. **Backend logic**: Update the Python files in the root directory
4. **API endpoints**: Add new routes in `app.py`