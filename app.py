from flask import Flask, jsonify, render_template
from werkzeug.exceptions import RequestEntityTooLarge
from api.routes import api_bp

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 512 * 1024 * 1024  # 512 MB

app.register_blueprint(api_bp, url_prefix="/api")


@app.errorhandler(RequestEntityTooLarge)
def handle_413(e):
    limit_mb = app.config["MAX_CONTENT_LENGTH"] // (1024 * 1024)
    return jsonify(error=f"File too large (limit: {limit_mb} MB)"), 413


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    app.run(debug=True)
