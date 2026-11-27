import http.server
import os
import socketserver
import threading
import webbrowser


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def start_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    handler = http.server.SimpleHTTPRequestHandler

    httpd = None
    for port in (5500, 8899, 8765, 9000, 18080, 0):
        try:
            httpd = ReusableTCPServer(("127.0.0.1", port), handler)
            break
        except OSError:
            continue

    if httpd is None:
        print("Failed to bind any local port.")
        return

    actual_port = httpd.server_address[1]
    url = f"http://127.0.0.1:{actual_port}/"
    print("======================================================")
    print("  Sunshine Portfolio Local Preview Running!")
    print(f"  URL: {url}")
    print("  Close this window or press Ctrl+C to stop.")
    print("======================================================")

    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    start_server()
