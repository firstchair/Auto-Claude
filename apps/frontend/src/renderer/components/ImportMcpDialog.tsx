/**
 * Import MCP Servers from Claude Code Dialog
 *
 * Discovers MCP server configurations from Claude Code's config files
 * (~/.claude.json and .mcp.json), displays compatibility status, and
 * allows selective import into Auto Claude's custom MCP server system.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { useTranslation } from 'react-i18next';
import type { CustomMcpServer, DiscoveredMcpServer, DiscoveredMcpServers } from '../../shared/types';
import {
  Terminal,
  Globe,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Info,
  FileText,
} from 'lucide-react';

interface ImportMcpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectDir: string;
  existingServerIds: string[];
  onImport: (servers: CustomMcpServer[]) => void;
}

export function ImportMcpDialog({
  open,
  onOpenChange,
  projectDir,
  existingServerIds,
  onImport,
}: ImportMcpDialogProps) {
  const { t } = useTranslation(['settings', 'common']);

  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<DiscoveredMcpServers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const discover = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSelectedIds(new Set());

    try {
      const response = await window.electronAPI.discoverClaudeCodeMcpServers(
        projectDir,
        existingServerIds,
      );
      if (response.success && response.data) {
        setResult(response.data);
      } else {
        setError(response.error || t('mcp.importDialog.importError'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcp.importDialog.importError'));
    } finally {
      setLoading(false);
    }
  }, [projectDir, existingServerIds, t]);

  useEffect(() => {
    if (open) {
      discover();
    }
  }, [open, discover]);

  const compatibleServers = result?.servers.filter(
    (s) => s.isCompatible && !s.alreadyImported,
  ) ?? [];

  const allCompatibleSelected =
    compatibleServers.length > 0 &&
    compatibleServers.every((s) => selectedIds.has(s.id));

  const toggleServer = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allCompatibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(compatibleServers.map((s) => s.id)));
    }
  };

  const handleImport = () => {
    if (!result) return;

    setImporting(true);

    const selected = result.servers.filter((s) => selectedIds.has(s.id));
    const imported: CustomMcpServer[] = selected.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      ...(s.type === 'command'
        ? { command: s.command, args: s.args }
        : { url: s.url, headers: s.headers }),
      ...(s.env && Object.keys(s.env).length > 0 ? { env: s.env } : {}),
      source: 'claude-code' as const,
      sourceScope: s.sourceScope,
    }));

    onImport(imported);
    setImporting(false);
    onOpenChange(false);
  };

  const getScopeLabel = (scope: DiscoveredMcpServer['sourceScope']) => {
    switch (scope) {
      case 'global':
        return t('mcp.importDialog.scopeGlobal');
      case 'local':
        return t('mcp.importDialog.scopeLocal');
      case 'project':
        return t('mcp.importDialog.scopeProject');
    }
  };

  const getScopeBadgeClass = (scope: DiscoveredMcpServer['sourceScope']) => {
    switch (scope) {
      case 'global':
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
      case 'local':
        return 'bg-purple-500/10 text-purple-600 dark:text-purple-400';
      case 'project':
        return 'bg-green-500/10 text-green-600 dark:text-green-400';
    }
  };

  const renderServerRow = (server: DiscoveredMcpServer) => {
    const isSelectable = server.isCompatible && !server.alreadyImported;
    const isSelected = selectedIds.has(server.id);

    return (
      <div
        key={`${server.sourceScope}-${server.id}`}
        className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
          isSelectable
            ? 'border-border hover:bg-muted/50 cursor-pointer'
            : 'border-border/50 opacity-60'
        } ${isSelected ? 'bg-primary/5 border-primary/30' : ''}`}
        onClick={() => isSelectable && toggleServer(server.id)}
        onKeyDown={(e) => {
          if (isSelectable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            toggleServer(server.id);
          }
        }}
        role={isSelectable ? 'checkbox' : undefined}
        aria-checked={isSelectable ? isSelected : undefined}
        tabIndex={isSelectable ? 0 : undefined}
      >
        {/* Checkbox or status icon */}
        <div className="pt-0.5 flex-shrink-0">
          {server.alreadyImported ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : !server.isCompatible ? (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          ) : (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleServer(server.id)}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>

        {/* Server details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Type icon */}
            {server.type === 'command' ? (
              <Terminal className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            ) : (
              <Globe className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            )}

            {/* Name */}
            <span className="font-medium text-sm truncate">{server.name}</span>

            {/* Scope badge */}
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${getScopeBadgeClass(server.sourceScope)}`}
            >
              {getScopeLabel(server.sourceScope)}
            </span>

            {/* Status badges */}
            {server.alreadyImported && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
                {t('mcp.importDialog.alreadyImported')}
              </span>
            )}
            {!server.isCompatible && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                {t('mcp.importDialog.incompatible')}
              </span>
            )}
          </div>

          {/* Command/URL details */}
          <div className="text-xs text-muted-foreground mt-1 truncate">
            {server.type === 'command'
              ? `${server.command || ''} ${(server.args || []).join(' ')}`.trim()
              : server.url || ''}
          </div>

          {/* Incompatible reason */}
          {server.incompatibleReason && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              {server.incompatibleReason}
            </p>
          )}

          {/* Unresolved env vars warning */}
          {server.hasUnresolvedEnvVars && server.isCompatible && (
            <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mt-1">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              <span>{t('mcp.importDialog.unresolvedEnvVars')}</span>
            </div>
          )}

          {/* Env var count */}
          {server.env && Object.keys(server.env).length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <Info className="h-3 w-3 flex-shrink-0" />
              <span>
                {t('mcp.importDialog.envVarsLabel')}: {Object.keys(server.env).length}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('mcp.importDialog.title')}</DialogTitle>
          <DialogDescription>{t('mcp.importDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">{t('mcp.importDialog.scanning')}</span>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
              {error}
            </div>
          )}

          {/* No servers found */}
          {result && result.servers.length === 0 && !loading && (
            <div className="text-center py-8">
              <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium">
                {t('mcp.importDialog.noServersFound')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t('mcp.importDialog.noServersFoundDescription')}
              </p>
            </div>
          )}

          {/* Server list */}
          {result && result.servers.length > 0 && !loading && (
            <>
              {/* Summary */}
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {t('mcp.importDialog.serversFound', { count: result.servers.length })}
                  {' — '}
                  {t('mcp.importDialog.compatibleCount', { count: compatibleServers.length })}
                </span>
              </div>

              {/* Select all toggle */}
              {compatibleServers.length > 0 && (
                <div
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={toggleSelectAll}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleSelectAll();
                    }
                  }}
                  role="checkbox"
                  aria-checked={allCompatibleSelected}
                  tabIndex={0}
                >
                  <Checkbox
                    checked={allCompatibleSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                  <span className="text-sm font-medium">
                    {allCompatibleSelected
                      ? t('mcp.importDialog.deselectAll')
                      : t('mcp.importDialog.selectAllCompatible')}
                  </span>
                </div>
              )}

              {/* Server rows */}
              <div className="space-y-2">
                {result.servers.map(renderServerRow)}
              </div>

              {/* Sources checked summary */}
              {result.sourcesChecked.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground transition-colors">
                    {t('mcp.importDialog.sourcesChecked')}
                  </summary>
                  <div className="mt-1 space-y-0.5 pl-2">
                    {result.sourcesChecked.map((source) => (
                      <div key={source.file} className="flex items-center gap-1">
                        <span className="truncate">{source.file}</span>
                        <span>—</span>
                        <span>
                          {source.error
                            ? t('mcp.importDialog.sourceError')
                            : source.exists
                              ? t('mcp.importDialog.sourceFound', { count: source.serverCount })
                              : t('mcp.importDialog.sourceNotFound')}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('mcp.importDialog.cancel')}
          </Button>
          <Button
            onClick={handleImport}
            disabled={selectedIds.size === 0 || importing || loading}
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                {t('mcp.importDialog.importing')}
              </>
            ) : (
              t('mcp.importDialog.importSelected', { count: selectedIds.size })
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
