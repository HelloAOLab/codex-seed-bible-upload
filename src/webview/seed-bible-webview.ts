import * as vscode from 'vscode';
import { uploadToSeedBible } from '../commands/upload-to-seed-bible';

/**
 * Manages the webview panel for the Seed Bible Upload UI
 */
export class SeedBibleWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'seed-bible.webview';

  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this._extensionUri = context.extensionUri;
    this._context = context;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      // Enable scripts in the webview
      enableScripts: true,
      
      // Restrict the webview to only load resources from the extension's directory
      localResourceRoots: [this._extensionUri]
    };

    // Set webview's initial html content
    webviewView.webview.html = this._getWebviewContent(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'uploadToSeedBible':
          await uploadToSeedBible(this._context);
          break;
      }
    });
  }

  private _getWebviewContent(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Seed Bible Upload</title>
        <style>
            body {
                padding: 20px;
                color: var(--vscode-foreground);
                font-family: var(--vscode-font-family);
                background-color: var(--vscode-editor-background);
            }
            .container {
                display: flex;
                flex-direction: column;
                gap: 16px;
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
            }
            button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            button:active {
                background-color: var(--vscode-button-background);
                transform: translateY(1px);
            }
            h2 {
                margin-top: 0;
                border-bottom: 1px solid var(--vscode-input-border);
                padding-bottom: 8px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Seed Bible Tools</h2>
            <p>Use the button below to upload your translation to the Seed Bible repository.</p>
            <button id="uploadButton">Upload to Seed Bible</button>
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
