export {}

declare global {
  interface Window {
    codexDesigner?: {
      setWindowTitle(title: string): Promise<boolean>
      pickWorkspace(): Promise<string | null>
      getAppState(): Promise<{
        version: 1
        activeWorkspacePath?: string
        recentWorkspacePaths: string[]
      }>
      listModels(): Promise<
        Array<{
          model: string
          displayName: string
          description: string
          isDefault: boolean
        }>
      >
      getClipboardFormats(): Promise<string[]>
      readClipboardImageDataUrl(): Promise<string | null>
      openWorkspace(workspacePath: string): Promise<{
        path: string
        isGitRepo: boolean
        isGitClean: boolean | null
        headCommit: string | null
        shareability: 'local' | 'shareable' | null
        features: {
          slug: string
          docsDir: string
          planPath: string
          qnaPath: string
          implPath: string
          testJsonPath: string
          testMdPath: string
          assetsDir: string
          updatedAtMs: number | null
        }[]
      }>
      setWorkspaceShareability(
        workspacePath: string,
        shareability: 'local' | 'shareable'
      ): Promise<{
        path: string
        isGitRepo: boolean
        isGitClean: boolean | null
        headCommit: string | null
        shareability: 'local' | 'shareable' | null
        features: {
          slug: string
          docsDir: string
          planPath: string
          qnaPath: string
          implPath: string
          testJsonPath: string
          testMdPath: string
          assetsDir: string
          updatedAtMs: number | null
        }[]
      }>
      initGit(workspacePath: string): Promise<{
        path: string
        isGitRepo: boolean
        isGitClean: boolean | null
        headCommit: string | null
        shareability: 'local' | 'shareable' | null
        features: {
          slug: string
          docsDir: string
          planPath: string
          qnaPath: string
          implPath: string
          testJsonPath: string
          testMdPath: string
          assetsDir: string
          updatedAtMs: number | null
        }[]
      }>
      exportProfiles(workspacePath: string): Promise<string | null>
      importProfiles(workspacePath: string): Promise<string | null>
      startRun(args: {
        workspacePath: string
        featureSlug?: string
        role: 'planning' | 'implementation' | 'testing' | 'generic'
        profileId: 'careful' | 'yolo'
        model?: string
        modelReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
        input:
          | string
          | Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }>
        outputSchema?: unknown
        oneShotNetwork?: boolean
      }): Promise<{ runId: string }>
      abortRun(runId: string): Promise<void>
      onRunEvent(callback: (payload: { runId: string; event: unknown }) => void): () => void
      readTextFile(workspacePath: string, relPath: string): Promise<string>
      writeTextFile(workspacePath: string, relPath: string, content: string): Promise<boolean>
      saveAttachment(args: {
        workspacePath: string
        featureSlug: string
        ext: string
        bytesBase64: string
      }): Promise<{ relPath: string }>
      readAttachmentDataUrl(workspacePath: string, relPath: string): Promise<string>
      deleteAttachment(workspacePath: string, relPath: string): Promise<boolean>
      getGitDiffStat(workspacePath: string, fromCommit: string): Promise<string>
      getGitDiff(workspacePath: string, fromCommit: string): Promise<string>
      gitCommitAll(
        workspacePath: string,
        message: string
      ): Promise<{ commit: string; stdout: string; stderr: string }>
      listRunLogs(filter?: { workspacePath?: string; featureSlug?: string }): Promise<any[]>
      readRunLog(runId: string, limit?: number): Promise<{ meta: any; events: any[] }>
    }
  }
}
