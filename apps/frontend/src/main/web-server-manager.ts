/**
 * Web Server Manager
 * Manages Express.js server lifecycle for browser access to the application
 */

import express, { type Express } from 'express';
import type { Server } from 'http';
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

      // Get static files path
      const staticPath = this.getStaticPath();

      // Serve static files from renderer output
      this.expressApp.use(express.static(staticPath));

      // Fallback to index.html for SPA routing
      this.expressApp.get('*', (_req, res) => {
        res.sendFile(path.join(staticPath, 'index.html'));
      });

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
   * @param port - Port number to check
   * @returns true if port is available, false if in use
   */
  private checkPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const testServer = net.createServer();

      testServer.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          // Other errors (e.g., EACCES) - treat as unavailable
          resolve(false);
        }
      });

      testServer.once('listening', () => {
        // Port is available, close the test server
        testServer.close(() => {
          resolve(true);
        });
      });

      // Try to listen on the port (localhost only)
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
