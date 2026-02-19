/**
 * Claude Code MCP Import API
 *
 * Exposes Claude Code MCP server discovery functionality to the renderer.
 */

import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants/ipc';
import type { IPCResult } from '../../../shared/types/common';
import type { DiscoveredMcpServers } from '../../../shared/types/project';

export interface ClaudeCodeMcpAPI {
  /** Discover MCP servers from Claude Code config files */
  discoverClaudeCodeMcpServers: (
    projectDir: string,
    existingServerIds: string[],
  ) => Promise<IPCResult<DiscoveredMcpServers>>;
}

export function createClaudeCodeMcpAPI(): ClaudeCodeMcpAPI {
  return {
    discoverClaudeCodeMcpServers: (projectDir: string, existingServerIds: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.CLAUDE_CODE_MCP_DISCOVER, projectDir, existingServerIds),
  };
}
