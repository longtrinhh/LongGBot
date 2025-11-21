from flask import Flask
from flask_compress import Compress
from config import FLASK_SECRET_KEY
import logging
from routes.general import general_bp
from routes.chat import chat_bp
from routes.image import image_bp
from routes.upload import upload_bp

app = Flask(__name__)
app.secret_key = FLASK_SECRET_KEY

compress = Compress()
compress.init_app(app)
app.config['COMPRESS_MIMETYPES'] = ['text/html', 'text/css', 'text/javascript', 'application/json', 'application/javascript']
app.config['COMPRESS_LEVEL'] = 6
app.config['COMPRESS_MIN_SIZE'] = 500

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Disable Werkzeug request logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

# Register Blueprints
app.register_blueprint(general_bp)
app.register_blueprint(chat_bp)
app.register_blueprint(image_bp)
app.register_blueprint(upload_bp)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)