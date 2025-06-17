import * as vscode from 'vscode';
import { uploadToSeedBible } from '../commands/upload-to-seed-bible';

/**
 * Manages a webview panel for Seed Bible upload functionality
 */
export class SeedBiblePanel {
  /**
   * Track the currently panel. Only allow a single panel to exist at a time.
   */
  public static currentPanel: SeedBiblePanel | undefined;

  public static readonly viewType = 'seedBiblePanel';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if (SeedBiblePanel.currentPanel) {
      SeedBiblePanel.currentPanel._panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      SeedBiblePanel.viewType,
      'Seed Bible Upload',
      column || vscode.ViewColumn.One,
      {
        // Enable javascript in the webview
        enableScripts: true,

        // And restrict the webview to only loading content from our extension's directory
        localResourceRoots: [extensionUri],
      }
    );

    SeedBiblePanel.currentPanel = new SeedBiblePanel(
      panel,
      extensionUri,
      context
    );
  }

  public static revive(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
  ) {
    SeedBiblePanel.currentPanel = new SeedBiblePanel(
      panel,
      extensionUri,
      context
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._context = context;

    // Set the webview's initial html content
    this._update();

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'uploadToSeedBible':
            await uploadToSeedBible(this._context);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public dispose() {
    SeedBiblePanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.title = 'Seed Bible Upload';
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Seed Bible Upload</title>
        <style>
            body {
                padding: 24px;
                color: var(--vscode-foreground);
                font-family: var(--vscode-font-family);
                background-color: var(--vscode-editor-background);
            }
            .container {
                max-width: 800px;
                margin: 0 auto;
                display: flex;
                flex-direction: column;
                gap: 20px;
            }
            button {
                padding: 8px 16px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 2px;
                cursor: pointer;
                font-size: 14px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                max-width: 200px;
            }
            button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            button:active {
                background-color: var(--vscode-button-background);
                transform: translateY(1px);
            }
            h1 {
                margin-top: 0;
                border-bottom: 1px solid var(--vscode-input-border);
                padding-bottom: 10px;
            }
            .card {
                background-color: var(--vscode-editor-inactiveSelectionBackground);
                padding: 16px;
                border-radius: 4px;
                margin-bottom: 16px;
            }
            .card h3 {
                margin-top: 0;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Seed Bible Translation Tools</h1>
            
            <div class="card">
                <h3>Upload Translation</h3>
                <p>Use this button to upload your translation to the Seed Bible repository. The upload process will:</p>
                <ul>
                    <li>Validate your translation files</li>
                    <li>Upload them to the Seed Bible S3 bucket</li>
                    <li>Make them available for viewing in the Seed Bible web app</li>
                </ul>
                <button id="uploadButton">Upload to Seed Bible</button>
            </div>
            
            <p>For more information about the Seed Bible project, please visit the <a href="https://helloao.org" target="_blank">Seed Bible website</a>.</p>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            
            document.getElementById('uploadButton').addEventListener('click', () => {
                vscode.postMessage({
                    command: 'uploadToSeedBible'
                });
            });
        </script>
    </body>
    </html>`;
  }
}

export function registerSeedBiblePanelCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand('seed-bible.openPanel', () => {
    SeedBiblePanel.createOrShow(context.extensionUri, context);
  });
}
