"""Production WSGI entry point. One process owns the in-memory job registries."""
import logging

from waitress import serve

from settings import MAX_UPLOAD_BYTES, server_port


def main():
    from app import app
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    port = server_port()
    logging.getLogger(__name__).info("Cozy-Fi Studio: http://127.0.0.1:%d", port)
    serve(app, host="127.0.0.1", port=port, threads=8,
          max_request_body_size=MAX_UPLOAD_BYTES, clear_untrusted_proxy_headers=True)


if __name__ == "__main__":
    main()
