/**
 * Web Server Manager
 * Manages Express.js server lifecycle for browser access to the application
 */

import express, { type Express, type Request, type Response } from 'express';
import http, { type Server, type IncomingMessage } from 'http';
import net from 'net';
import path from 'path';
import { app } from 'electron';
import { is } from '@electron-toolkit/utils';

/**
 * Status of the web server
 */
export interface WebServerStatus {
  running: boolean;
  port?: number;
  url?: string;
  error?: string;
}

/**
 * Port validation constraints
 */
const MIN_PORT = 1024;
const MAX_PORT = 65535;
const DEFAULT_PORT = 3000;

/**
 * WebServerManager class
 * Encapsulates Express.js server lifecycle for serving the application UI via browser
 */
export class WebServerManager {
  private server: Server | null = null;
  private expressApp: Express | null = null;
  private currentPort: number | null = null;

  /**
   * Start the web server on the specified port
   * @param port - Port number to listen on (must be between 1024-65535)
   * @returns WebServerStatus indicating success or failure
   */
  async start(port: number = DEFAULT_PORT): Promise<WebServerStatus> {
    // Validate port number
    if (!this.isValidPort(port)) {
      return {
        running: false,
        error: `Invalid port number. Port must be between ${MIN_PORT} and ${MAX_PORT}.`
      };
    }

    // Check if port is available before attempting to start
    const portAvailable = await this.checkPortAvailable(port);
    if (!portAvailable) {
      return {
        running: false,
        error: `Port ${port} is already in use. Please choose another port.`
      };
    }

    // Stop existing server if running
    if (this.server) {
      await this.stop();
    }

    try {
      // Create Express application
      this.expressApp = express();

      // In development mode, proxy to the Vite dev server
      // In production mode, serve static files
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        const viteUrl = new URL(process.env['ELECTRON_RENDERER_URL']);
        console.log(`[WebServerManager] Dev mode: proxying to Vite dev server at ${viteUrl.href}`);

        // Proxy all requests to the Vite dev server
        this.expressApp.use((req: Request, res: Response) => {
          this.proxyToVite(req, res, viteUrl);
        });
      } else {
        // Production mode: serve static files
        const staticPath = this.getStaticPath();

        // Serve static files from renderer output
        this.expressApp.use(express.static(staticPath));

        // Fallback to index.html for SPA routing
        this.expressApp.get('*', (_req, res) => {
          res.sendFile(path.join(staticPath, 'index.html'));
        });
      }

      // Start server bound to localhost only (security requirement)
      return await new Promise<WebServerStatus>((resolve) => {
        this.server = this.expressApp!.listen(port, '127.0.0.1', () => {
          this.currentPort = port;
          resolve({
            running: true,
            port,
            url: `http://localhost:${port}`
          });
        });

        // Handle server errors (e.g., port in use)
        this.server.on('error', (error: NodeJS.ErrnoException) => {
          this.cleanup();

          if (error.code === 'EADDRINUSE') {
            resolve({
              running: false,
              error: `Port ${port} is already in use. Please choose another port.`
            });
          } else {
            resolve({
              running: false,
              error: `Failed to start server: ${error.message}`
            });
          }
        });
      });
    } catch (error) {
      this.cleanup();
      return {
        running: false,
        error: error instanceof Error ? error.message : 'Unknown error starting server'
      };
    }
  }

  /**
   * Proxy request to Vite dev server (for development mode)
   * @param req - Express request
   * @param res - Express response
   * @param viteUrl - Vite dev server URL
   */
  private proxyToVite(req: Request, res: Response, viteUrl: URL): void {
    const options = {
      hostname: viteUrl.hostname,
      port: viteUrl.port || (viteUrl.protocol === 'https:' ? 443 : 80),
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: viteUrl.host
      }
    };

    const proxyReq = http.request(options, (proxyRes: IncomingMessage) => {
      // Copy status code and headers
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers as { [key: string]: string | string[] | undefined });
      // Pipe the response
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (error) => {
      console.error('[WebServerManager] Proxy error:', error.message);
      if (!res.headersSent) {
        res.status(502).send(`Proxy error: ${error.message}`);
      }
    });

    // Pipe the request body
    req.pipe(proxyReq);
  }

  /**
   * Stop the web server gracefully
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise<void>((resolve) => {
      this.server!.close((error) => {
        if (error) {
          // Server might already be closed, just log and continue
          console.warn('[WebServerManager] Error closing server:', error.message);
        }
        this.cleanup();
        resolve();
      });
    });
  }

  /**
   * Get the current server status
   * @returns WebServerStatus indicating current state
   */
  getStatus(): WebServerStatus {
    if (this.server && this.currentPort) {
      return {
        running: true,
        port: this.currentPort,
        url: `http://localhost:${this.currentPort}`
      };
    }

    return {
      running: false
    };
  }

  /**
   * Check if the server is currently running
   */
  isRunning(): boolean {
    return this.server !== null && this.currentPort !== null;
  }

  /**
   * Get the static files path based on environment
   * @returns Path to static files directory
   */
  private getStaticPath(): string {
    if (is.dev) {
      // Development: serve from renderer output directory
      // __dirname is out/main, renderer is at out/renderer
      return path.join(__dirname, '../renderer');
    } else {
      // Production: serve from packaged app resources
      return path.join(app.getAppPath(), 'out', 'renderer');
    }
  }

  /**
   * Validate port number is within acceptable range
   * @param port - Port number to validate
   * @returns true if port is valid
   */
  private isValidPort(port: number): boolean {
    return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
  }

  /**
   * Check if a port is available for use
   * Uses connection-based approach to detect if anything is listening on the port
   * This is more reliable than bind-based checking as it detects services on any interface
   * @param port - Port number to check
   * @returns true if port is available, false if in use
   */
  checkPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      // First, try to connect to the port to see if anything is listening
      // This catches services listening on any interface (0.0.0.0, ::, 127.0.0.1, etc.)
      const socket = new net.Socket();
      let resolved = false;

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      socket.setTimeout(1000); // 1 second timeout

      socket.once('connect', () => {
        // Something is listening on this port
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(false);
        }
      });

      socket.once('timeout', () => {
        // Connection timed out - likely nothing listening
        if (!resolved) {
          resolved = true;
          cleanup();
          // Do a bind check as backup
          this.checkPortBindable(port).then(resolve);
        }
      });

      socket.once('error', (err: NodeJS.ErrnoException) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          if (err.code === 'ECONNREFUSED') {
            // Connection refused means nothing is listening - port is available
            // But still do a bind check to be sure
            this.checkPortBindable(port).then(resolve);
          } else {
            // Other errors - treat as unavailable for safety
            resolve(false);
          }
        }
      });

      // Try to connect to localhost on the port
      socket.connect(port, '127.0.0.1');
    });
  }

  /**
   * Check if we can bind to a port (secondary check after connection test)
   * @param port - Port number to check
   * @returns true if port can be bound, false otherwise
   */
  private checkPortBindable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const testServer = net.createServer();

      testServer.once('error', () => {
        resolve(false);
      });

      testServer.once('listening', () => {
        testServer.close(() => {
          resolve(true);
        });
      });

      testServer.listen(port, '127.0.0.1');
    });
  }

  /**
   * Clean up internal state after server stops
   */
  private cleanup(): void {
    this.server = null;
    this.expressApp = null;
    this.currentPort = null;
  }
}

// Export singleton instance getter for use in main process
let webServerManagerInstance: WebServerManager | null = null;

/**
 * Get or create the WebServerManager singleton instance
 */
export function getWebServerManager(): WebServerManager {
  if (!webServerManagerInstance) {
    webServerManagerInstance = new WebServerManager();
  }
  return webServerManagerInstance;
}
