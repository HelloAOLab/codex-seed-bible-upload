import * as vscode from 'vscode';
import { uploadToSeedBible } from '../commands/upload-to-seed-bible';
import { InputTranslationMetadata } from '@helloao/tools/generation/index.js';
import { log } from '@helloao/tools';
import { getClient, getOptions, login } from '../utils';
import { RecordsClient } from '@casual-simulation/aux-records/RecordsClient';
import {
  getSessionKeyExpiration,
  isExpired,
  parseSessionKey,
} from '@casual-simulation/aux-common';

/**
 * Manages the webview panel for the Seed Bible Upload UI
 */
export class SeedBibleWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'seed-bible.webview';

  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _context: vscode.ExtensionContext;
  private _metadata?: InputTranslationMetadata;

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

    // Set the webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Set the webview's title
    webviewView.description = 'Seed Bible Upload Tools';

    // Load the metadata and check login status, then set the webview content
    Promise.all([this._loadMetadata(), this._checkLoginStatus()]).then(
      ([_, loginStatus]) => {
        // Set webview's initial html content
        webviewView.webview.html = this._getWebviewContent(
          webviewView.webview,
          loginStatus
        );
      }
    );

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'uploadToSeedBible':
          await uploadToSeedBible(this._context);
          break;
        case 'saveMetadata':
          await this._saveMetadata(message.metadata);
          vscode.window.showInformationMessage('Metadata saved successfully!');
          break;
        case 'loadMetadata':
          await this._loadMetadata();
          if (this._metadata && this._view) {
            this._view.webview.postMessage({
              command: 'updateMetadata',
              metadata: this._metadata,
            });
          }
          break;
        case 'login':
          try {
            await login(this._context);

            // Check login status after login attempt
            const loginStatus = await this._checkLoginStatus();

            // Update the account tab with new status
            if (this._view) {
              this._view.webview.postMessage({
                command: 'updateLoginStatus',
                loginStatus,
              });
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Login failed: ${error}`);
          }
          break;
        case 'checkLoginStatus':
          const status = await this._checkLoginStatus();
          webviewView.webview.postMessage({
            command: 'updateLoginStatus',
            status: status,
          });
          break;
      }
    });
  }
  private _getWebviewContent(
    webview: vscode.Webview,
    loginStatus?: { isLoggedIn: boolean; userInfo?: any }
  ): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Seed Bible Upload</title>
        <style>
            body {
                padding: 16px;
                color: var(--vscode-foreground);
                font-family: var(--vscode-font-family);
                background-color: var(--vscode-editor-background);
                font-size: 13px;
            }
            .container {
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            button {
                padding: 6px 14px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 2px;
                cursor: pointer;
                font-size: 13px;
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
            h2 {
                margin-top: 0;
                margin-bottom: 16px;
                border-bottom: 1px solid var(--vscode-input-border);
                padding-bottom: 8px;
                font-size: 14px;
                font-weight: 600;
            }
            .card {
                background-color: var(--vscode-editor-inactiveSelectionBackground);
                padding: 12px;
                border-radius: 4px;
                margin-bottom: 16px;
            }
            .card h3 {
                margin-top: 0;
                margin-bottom: 12px;
                font-size: 13px;
                font-weight: 600;
            }
            .form-group {
                margin-bottom: 12px;
            }
            .form-group label {
                display: block;
                margin-bottom: 4px;
                font-weight: 500;
            }
            .form-group input, .form-group select {
                width: 100%;
                padding: 4px 8px;
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 2px;
                font-family: var(--vscode-font-family);
                font-size: 13px;
            }
            .form-group input:focus, .form-group select:focus {
                outline: 1px solid var(--vscode-focusBorder);
                border-color: var(--vscode-focusBorder);
            }
            .form-actions {
                display: flex;
                gap: 8px;
                margin-top: 16px;
            }
            .tabs {
                display: flex;
                border-bottom: 1px solid var(--vscode-tab-border);
                margin-bottom: 16px;
            }
            .tab {
                padding: 6px 12px;
                cursor: pointer;
                border: none;
                background: none;
                color: var(--vscode-tab-inactiveForeground);
                font-family: var(--vscode-font-family);
                font-size: 13px;
            }
            .tab.active {
                color: var(--vscode-tab-activeForeground);
                border-bottom: 2px solid var(--vscode-tab-activeBorder);
            }
            .tab-content {
                display: none;
            }
            .tab-content.active {
                display: block;
            }
            .helper-text {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                margin-top: 4px;
            }
            a {
                color: var(--vscode-textLink-foreground);
                text-decoration: none;
            }
            a:hover {
                color: var(--vscode-textLink-activeForeground);
                text-decoration: underline;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="tabs">
                <button class="tab active" data-tab="upload">Upload</button>
                <button class="tab" data-tab="metadata">Metadata</button>
                <button class="tab" data-tab="account">Account</button>
            </div>
            
            <div class="tab-content active" id="upload-tab">
                <h2>Upload Translation</h2>
                <div class="card">
                    <h3>Upload to Seed Bible</h3>
                    <p>Use this button to upload your translation to the Seed Bible repository. The upload process will:</p>
                    <ul>
                        <li>Validate your translation files</li>
                        <li>Upload them to the Seed Bible S3 bucket</li>
                        <li>Make them available for viewing in the Seed Bible web app</li>
                    </ul>
                    <button id="uploadButton">Upload to Seed Bible</button>
                </div>
            </div>

            <div class="tab-content" id="metadata-tab">
                <h2>Translation Metadata</h2>
                <form id="metadataForm">
                    <div class="card">
                        <h3>Basic Information</h3>
                        <div class="form-group">
                            <label for="id">ID (short code):</label>
                            <input type="text" id="id" name="id" required>
                            <div class="helper-text">A short identifier (e.g., "kjv", "niv")</div>
                        </div>
                        <div class="form-group">
                            <label for="name">Name:</label>
                            <input type="text" id="name" name="name" required>
                            <div class="helper-text">The name of the translation in its own language</div>
                        </div>
                        <div class="form-group">
                            <label for="englishName">English Name:</label>
                            <input type="text" id="englishName" name="englishName" required>
                            <div class="helper-text">The name of the translation in English</div>
                        </div>
                    </div>
                    
                    <div class="card">
                        <h3>Language Settings</h3>
                        <div class="form-group">
                            <label for="language">Language Code:</label>
                            <input type="text" id="language" name="language" required>
                            <div class="helper-text">ISO 639-3 language code (e.g., "eng" for English)</div>
                        </div>
                        <div class="form-group">
                            <label for="direction">Text Direction:</label>
                            <select id="direction" name="direction">
                                <option value="ltr">Left to Right (LTR)</option>
                                <option value="rtl">Right to Left (RTL)</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="card">
                        <h3>Additional Information</h3>
                        <div class="form-group">
                            <label for="website">Website:</label>
                            <input type="url" id="website" name="website">
                            <div class="helper-text">Website for the translation (optional)</div>
                        </div>
                        <div class="form-group">
                            <label for="licenseUrl">License URL:</label>
                            <input type="url" id="licenseUrl" name="licenseUrl">
                            <div class="helper-text">URL to the license information (optional)</div>
                        </div>
                    </div>
                    
                    <div class="form-actions">
                        <button type="button" id="saveMetadataBtn">Save Metadata</button>
                        <button type="button" id="reloadMetadataBtn">Reload</button>
                    </div>
                </form>
            </div>

            <div class="tab-content" id="account-tab">
                <h2>Account Status</h2>
                <div id="login-status-loading" class="card">
                    <p>Checking login status...</p>
                </div>
                
                <div id="logged-in-view" class="card" style="display: none;">
                    <h3>You are logged in</h3>
                    <div id="user-info">
                        <p>Your session is active until: <span id="session-expires"></span></p>
                    </div>
                    <div class="form-actions">
                        <button type="button" id="refresh-login-btn">Refresh Status</button>
                    </div>
                </div>
                
                <div id="logged-out-view" class="card" style="display: none;">
                    <h3>You are not logged in</h3>
                    <p>You need to log in to upload translations to the Seed Bible.</p>
                    
                    <div class="form-group">
                        <label for="email">Email Address:</label>
                        <input type="email" id="login-email" placeholder="Enter your email address">
                    </div>
                    
                    <div class="form-actions">
                        <button type="button" id="login-btn">Log In</button>
                    </div>
                </div>
            </div>
            
            <p>For more information about the Seed Bible project, please visit the <a href="https://helloao.org" target="_blank">Seed Bible website</a>.</p>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            let currentMetadata = ${JSON.stringify(this._metadata || this._getDefaultMetadata())};
            let loginStatus = ${JSON.stringify(loginStatus || { isLoggedIn: false })};
            
            // Tab switching
            document.querySelectorAll('.tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    
                    tab.classList.add('active');
                    const tabName = tab.getAttribute('data-tab');
                    document.getElementById(tabName + '-tab').classList.add('active');
                    
                    // If switching to account tab, refresh login status
                    if (tabName === 'account') {
                        refreshLoginStatus();
                    }
                });
            });
            
            // Initialize form with current metadata
            function updateFormWithMetadata(metadata) {
                document.getElementById('id').value = metadata.id || '';
                document.getElementById('name').value = metadata.name || '';
                document.getElementById('englishName').value = metadata.englishName || '';
                document.getElementById('language').value = metadata.language || '';
                document.getElementById('direction').value = metadata.direction || 'ltr';
                document.getElementById('website').value = metadata.website || '';
                document.getElementById('licenseUrl').value = metadata.licenseUrl || '';
            }
            
            // Update the account tab with login status
            function updateLoginStatusUI(status) {
                const loadingEl = document.getElementById('login-status-loading');
                const loggedInView = document.getElementById('logged-in-view');
                const loggedOutView = document.getElementById('logged-out-view');
                
                // Hide all views first
                loadingEl.style.display = 'none';
                loggedInView.style.display = 'none';
                loggedOutView.style.display = 'none';
                
                if (status.isLoggedIn) {
                    // Show logged in view
                    loggedInView.style.display = 'block';
                    
                    // Update user info
                    if (status.userInfo) {
                        document.getElementById('session-expires').textContent = status.userInfo.sessionExpires;
                    }
                } else {
                    // Show logged out view
                    loggedOutView.style.display = 'block';
                }
            }
            
            // Refresh login status
            function refreshLoginStatus() {
                // Show loading view
                document.getElementById('login-status-loading').style.display = 'block';
                document.getElementById('logged-in-view').style.display = 'none';
                document.getElementById('logged-out-view').style.display = 'none';
                
                vscode.postMessage({
                    command: 'checkLoginStatus'
                });
            }
            
            // Initialize with current metadata
            updateFormWithMetadata(currentMetadata);
            
            // Initialize login status UI
            updateLoginStatusUI(loginStatus);
            
            // Listen for messages from the extension
            window.addEventListener('message', event => {
                const message = event.data;
                
                switch (message.command) {
                    case 'updateMetadata':
                        currentMetadata = message.metadata;
                        updateFormWithMetadata(currentMetadata);
                        break;
                    case 'updateLoginStatus':
                        loginStatus = message.status;
                        updateLoginStatusUI(loginStatus);
                        break;
                }
            });
            
            // Handle form submission
            document.getElementById('saveMetadataBtn').addEventListener('click', () => {
                const formData = {
                    id: document.getElementById('id').value,
                    name: document.getElementById('name').value,
                    englishName: document.getElementById('englishName').value,
                    language: document.getElementById('language').value,
                    direction: document.getElementById('direction').value,
                    website: document.getElementById('website').value,
                    licenseUrl: document.getElementById('licenseUrl').value
                };
                
                vscode.postMessage({
                    command: 'saveMetadata',
                    metadata: formData
                });
            });
            
            // Handle reload button
            document.getElementById('reloadMetadataBtn').addEventListener('click', () => {
                vscode.postMessage({
                    command: 'loadMetadata'
                });
            });
            
            // Handle upload button
            document.getElementById('uploadButton').addEventListener('click', () => {
                vscode.postMessage({
                    command: 'uploadToSeedBible'
                });
            });
            
            // Handle login button
            document.getElementById('login-btn').addEventListener('click', () => {
                // Show loading view
                document.getElementById('login-status-loading').style.display = 'block';
                document.getElementById('logged-in-view').style.display = 'none';
                document.getElementById('logged-out-view').style.display = 'none';
                
                vscode.postMessage({
                    command: 'login'
                });
            });
            
            // Handle refresh login button
            document.getElementById('refresh-login-btn').addEventListener('click', () => {
                refreshLoginStatus();
            });
        </script>
    </body>
    </html>`;
  }

  /**
   * Load the metadata from the workspace
   */
  private async _loadMetadata(): Promise<void> {
    const logger = log.getLogger();
    try {
      // Try to find the workspace folder
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        this._metadata = this._getDefaultMetadata();
        return;
      }

      // Look for the metadata file in the workspace
      let metadataUri: vscode.Uri | undefined;

      // If not found yet, check in root of each workspace folder
      if (!metadataUri) {
        for (let folder of workspaceFolders) {
          const possiblePath = vscode.Uri.joinPath(
            folder.uri,
            'seed-bible-metadata.json'
          );
          try {
            await vscode.workspace.fs.stat(possiblePath);
            metadataUri = possiblePath;
            break;
          } catch (e) {
            // File doesn't exist in this folder
          }
        }
      }

      // If found, read the metadata
      if (metadataUri) {
        const data = await vscode.workspace.fs.readFile(metadataUri);
        this._metadata = JSON.parse(new TextDecoder().decode(data));
        this._metadataUri = metadataUri;
      } else {
        this._metadata = this._getDefaultMetadata();
      }
    } catch (error) {
      logger.error('Error loading metadata:', error);
      this._metadata = this._getDefaultMetadata();
    }
  }

  /**
   * Save the metadata to the workspace
   */
  private async _saveMetadata(
    metadata: InputTranslationMetadata
  ): Promise<void> {
    const logger = log.getLogger();
    try {
      // If we don't have a URI yet, ask the user where to save
      if (!this._metadataUri) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          throw new Error('No workspace folder found to save metadata');
        }

        // Default to first workspace folder
        this._metadataUri = vscode.Uri.joinPath(
          workspaceFolders[0].uri,
          'seed-bible-metadata.json'
        );

        // If multiple folders, ask user which one to use
        if (workspaceFolders.length > 1) {
          const folderNames = workspaceFolders.map((folder) => folder.name);
          const selected = await vscode.window.showQuickPick(folderNames, {
            placeHolder: 'Select a workspace folder to save the metadata',
          });

          if (selected) {
            const selectedFolder = workspaceFolders.find(
              (f) => f.name === selected
            );
            if (selectedFolder) {
              this._metadataUri = vscode.Uri.joinPath(
                selectedFolder.uri,
                'seed-bible-metadata.json'
              );
            }
          }
        }
      }

      // Save the metadata
      this._metadata = metadata;
      const json = JSON.stringify(metadata, null, 2);
      await vscode.workspace.fs.writeFile(
        this._metadataUri,
        new TextEncoder().encode(json)
      );
    } catch (error) {
      logger.error('Error saving metadata:', error);
      vscode.window.showErrorMessage(`Failed to save metadata: ${error}`);
    }
  }

  /**
   * Get default metadata values
   */
  private _getDefaultMetadata(): InputTranslationMetadata {
    return {
      website: '',
      licenseUrl: '',
      id: '',
      name: '',
      englishName: '',
      language: '',
      direction: 'ltr',
    } as InputTranslationMetadata;
  }

  // Store the URI of the metadata file
  private _metadataUri?: vscode.Uri;

  /**
   * Check if the user is logged in and get their info
   */
  private async _checkLoginStatus(): Promise<{
    isLoggedIn: boolean;
    userInfo?: any;
  }> {
    const logger = log.getLogger();
    logger.log('Checking login status...');
    try {
      const client = await getClient(this._context);

      // Check if we have a valid session key
      if (!client.sessionKey) {
        logger.log('No valid session key found.');
        return { isLoggedIn: false };
      }

      // Check if the session key is expired
      const expiration = getSessionKeyExpiration(client.sessionKey);
      if (isExpired(expiration)) {
        logger.log('Session key is expired.');
        return { isLoggedIn: false };
      }

      const [userId] = parseSessionKey(client.sessionKey);
      const info = await client.getUserInfo(
        {
          userId,
        },
        getOptions()
      );

      if (!info.success) {
        logger.error('Failed to get user info:', info);
        return { isLoggedIn: false };
      }

      logger.log('User info:', info);

      // If we have a valid session key, we're logged in
      // For simplicity, we'll just show the session expiration time as user info
      return {
        isLoggedIn: true,
        userInfo: {
          ...info,
          sessionExpires: new Date(expiration).toLocaleString(),
        },
      };
    } catch (error) {
      logger.error('Error checking login status:', error);
      return { isLoggedIn: false };
    }
  }

  /**
   * Handle login from the webview
   */
  private async _handleLogin(
    email: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      await login(this._context);

      // Check login status after attempting login
      const status = await this._checkLoginStatus();

      if (status.isLoggedIn) {
        return {
          success: true,
          message: 'Login successful!',
        };
      } else {
        return {
          success: false,
          message: 'Login failed. Please try again.',
        };
      }
    } catch (error) {
      console.error('Error during login:', error);
      return {
        success: false,
        message: `Login failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
