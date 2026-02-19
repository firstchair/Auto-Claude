/**
 * Claude Code MCP Import Handlers
 *
 * IPC handlers for discovering MCP server configurations from Claude Code's
 * config files (~/.claude.json and <project>/.mcp.json).
 * Provides functionality to:
 * - Read and parse Claude Code MCP server configurations
 * - Map Claude Code server format to Auto Claude's CustomMcpServer format
 * - Check compatibility with Auto Claude's security requirements
 * - Detect already-imported servers
 */

import { ipcMain } from 'electron';
import { existsSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type { DiscoveredMcpServer, DiscoveredMcpServers } from '../../shared/types/project';

/**
 * Commands considered safe for Auto Claude's security requirements.
 * Mirrors the allowlist in mcp-handlers.ts and backend client.py.
 */
const SAFE_COMMANDS = new Set(['npx', 'npm', 'node', 'python', 'python3', 'uv', 'uvx']);

/**
 * Check if a command is in the safe allowlist.
 */
function isCommandSafe(command: string | undefined): boolean {
  if (!command) return false;
  if (command.includes('/') || command.includes('\\')) return false;
  return SAFE_COMMANDS.has(command);
}

/**
 * Convert a server name to a kebab-case ID.
 */
function toKebabId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Check if a string contains unresolved environment variable references like ${VAR}.
 */
function containsEnvVarRef(value: string): boolean {
  return /\$\{[^}]+\}/.test(value);
}

/**
 * Check if any values in the server config contain unresolved env var references.
 */
function hasUnresolvedEnvVars(server: ClaudeCodeMcpServerConfig): boolean {
  if (server.command && containsEnvVarRef(server.command)) return true;
  if (server.args?.some((arg) => containsEnvVarRef(arg))) return true;
  if (server.url && containsEnvVarRef(server.url)) return true;
  if (server.env) {
    for (const val of Object.values(server.env)) {
      if (containsEnvVarRef(val)) return true;
    }
  }
  if (server.headers) {
    for (const val of Object.values(server.headers)) {
      if (containsEnvVarRef(val)) return true;
    }
  }
  return false;
}

/** Shape of an MCP server entry in Claude Code config files */
interface ClaudeCodeMcpServerConfig {
  type?: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

/** Shape of ~/.claude.json */
interface ClaudeJsonConfig {
  mcpServers?: Record<string, ClaudeCodeMcpServerConfig>;
  projects?: Record<string, {
    mcpServers?: Record<string, ClaudeCodeMcpServerConfig>;
  }>;
}

/** Shape of .mcp.json */
interface McpJsonConfig {
  mcpServers?: Record<string, ClaudeCodeMcpServerConfig>;
}

/**
 * Map a Claude Code server type to Auto Claude's type.
 */
function mapServerType(ccType?: string): 'command' | 'http' {
  if (ccType === 'http' || ccType === 'sse') return 'http';
  return 'command';
}

/**
 * Map a single Claude Code MCP server config to a DiscoveredMcpServer.
 */
function mapServer(
  name: string,
  config: ClaudeCodeMcpServerConfig,
  sourceScope: DiscoveredMcpServer['sourceScope'],
  sourceFile: string,
  existingServerIds: Set<string>,
): DiscoveredMcpServer {
  const id = toKebabId(name);
  const type = mapServerType(config.type);

  let isCompatible = true;
  let incompatibleReason: string | undefined;

  if (type === 'command') {
    if (!isCommandSafe(config.command)) {
      isCompatible = false;
      incompatibleReason = config.command
        ? `Command '${config.command}' is not in the allowed commands list (${[...SAFE_COMMANDS].join(', ')})`
        : 'No command specified';
    }
  }

  return {
    name,
    id,
    type,
    command: config.command,
    args: config.args,
    url: config.url,
    headers: config.headers,
    env: config.env,
    sourceScope,
    sourceFile,
    isCompatible,
    incompatibleReason,
    alreadyImported: existingServerIds.has(id),
    hasUnresolvedEnvVars: hasUnresolvedEnvVars(config),
  };
}

/**
 * Safely read and parse a JSON file.
 * Returns [data, error] tuple.
 */
function readJsonFile<T>(filePath: string): [T | null, string | null] {
  try {
    if (!existsSync(filePath)) {
      return [null, null];
    }
    const content = readFileSync(filePath, 'utf-8');
    return [JSON.parse(content) as T, null];
  } catch (error) {
    return [null, error instanceof Error ? error.message : 'Unknown error'];
  }
}

/**
 * Discover MCP servers from Claude Code config files.
 */
function discoverServers(
  projectDir: string,
  existingServerIds: string[],
): DiscoveredMcpServers {
  const existingIds = new Set(existingServerIds);
  const servers: DiscoveredMcpServer[] = [];
  const sourcesChecked: DiscoveredMcpServers['sourcesChecked'] = [];

  const homeDir = os.homedir();

  // 1. Read ~/.claude.json - global/user-scoped servers
  const claudeJsonPath = path.join(homeDir, '.claude.json');
  const [claudeJson, claudeJsonError] = readJsonFile<ClaudeJsonConfig>(claudeJsonPath);

  if (claudeJsonError) {
    sourcesChecked.push({
      file: claudeJsonPath,
      exists: true,
      error: claudeJsonError,
      serverCount: 0,
    });
  } else if (claudeJson) {
    // Global mcpServers
    const globalServers = claudeJson.mcpServers ?? {};
    const globalEntries = Object.entries(globalServers);
    for (const [name, config] of globalEntries) {
      servers.push(mapServer(name, config, 'global', claudeJsonPath, existingIds));
    }

    // Project-local servers from projects.<projectDir>.mcpServers
    const resolvedProjectDir = path.resolve(projectDir);
    const projectConfig = claudeJson.projects?.[resolvedProjectDir];
    const localServers = projectConfig?.mcpServers ?? {};
    const localEntries = Object.entries(localServers);
    for (const [name, config] of localEntries) {
      servers.push(mapServer(name, config, 'local', claudeJsonPath, existingIds));
    }

    sourcesChecked.push({
      file: claudeJsonPath,
      exists: true,
      serverCount: globalEntries.length + localEntries.length,
    });
  } else {
    sourcesChecked.push({
      file: claudeJsonPath,
      exists: false,
      serverCount: 0,
    });
  }

  // 2. Read <project>/.mcp.json - project-scoped servers
  const mcpJsonPath = path.resolve(projectDir, '.mcp.json');
  const [mcpJson, mcpJsonError] = readJsonFile<McpJsonConfig>(mcpJsonPath);

  if (mcpJsonError) {
    sourcesChecked.push({
      file: mcpJsonPath,
      exists: true,
      error: mcpJsonError,
      serverCount: 0,
    });
  } else if (mcpJson) {
    const projectServers = mcpJson.mcpServers ?? {};
    const projectEntries = Object.entries(projectServers);
    for (const [name, config] of projectEntries) {
      servers.push(mapServer(name, config, 'project', mcpJsonPath, existingIds));
    }

    sourcesChecked.push({
      file: mcpJsonPath,
      exists: true,
      serverCount: projectEntries.length,
    });
  } else {
    sourcesChecked.push({
      file: mcpJsonPath,
      exists: false,
      serverCount: 0,
    });
  }

  return { servers, sourcesChecked };
}

/**
 * Register IPC handlers for Claude Code MCP server discovery.
 */
export function registerClaudeCodeMcpHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_CODE_MCP_DISCOVER,
    async (
      _event,
      projectDir: string,
      existingServerIds: string[],
    ): Promise<IPCResult<DiscoveredMcpServers>> => {
      try {
        const result = discoverServers(projectDir, existingServerIds);
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: `Failed to discover Claude Code MCP servers: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    },
  );
}
