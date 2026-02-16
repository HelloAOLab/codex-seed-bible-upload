import * as vscode from 'vscode';
import {
  uploadToSeedBible,
  SeedBibleMetadata,
} from '../commands/upload-to-seed-bible';
import { InputTranslationMetadata } from '@helloao/tools/generation/index.js';
import { log } from '@helloao/tools';
import { getClient, getOptions, login, logout } from '../utils';
import { RecordsClient } from '@casual-simulation/aux-records/RecordsClient';
import {
  getSessionKeyExpiration,
  isExpired,
  parseSessionKey,
} from '@casual-simulation/aux-common';
import { loadAnnotations, Annotation } from '../annotations';
import { initializeStateStore, type CellIdGlobalState } from '../stateStore';
import { getLogger } from '@helloao/tools/log.js';
import { getBookId, parseVerseReference } from '@helloao/tools/utils.js';

/**
 * Manages the webview panel for the Seed Bible Upload UI
 */
export class SeedBibleWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'seed-bible.webview';

  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _context: vscode.ExtensionContext;
  private _metadata?: SeedBibleMetadata;

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

    const l = getLogger();

    const getVerseRef = (cell: CellIdGlobalState | undefined | null) => {
      if (!cell) {
        return null;
      }
      if (cell.cellId) {
        const parsed = parseVerseReference(cell.cellId);
        if (parsed) {
          return parsed;
        }
      }

      if (cell.globalReferences) {
        for (const ref of cell.globalReferences) {
          const parsed = parseVerseReference(ref);
          if (parsed) {
            return parsed;
          }
        }
      }

      console.warn(
        'Could not parse verse reference from cell ID or global references:',
        { cell }
      );

      return null;
    };

    initializeStateStore().then(({ storeListener }) => {
      storeListener('cellId', async (value) => {
        l.log('NEW CELL ID:', value);

        if (!this._metadata?.recordKey) {
          l.log('No recordKey in metadata, skipping annotation load');
          return;
        }

        const verseRef = getVerseRef(value);

        if (verseRef) {
          const bookId = getBookId(verseRef.book);

          if (!bookId) {
            l.warn('Could not find book ID for book code:', verseRef.book);
          } else {
            const annotations = await loadAnnotations(
              this._context,
              this._metadata.recordKey,
              bookId,
              verseRef.chapter
            );

            webviewView.webview.postMessage({
              command: 'updateAnnotations',
              annotations,
              bookId: bookId,
              chapterNumber: verseRef.chapter,
              currentVerse: verseRef.verse,
            });
          }
        } else {
          l.log('No cell ID found:', value);
        }
      });
    });

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
        case 'logout':
          try {
            const success = await logout(this._context);

            // Check login status after logout attempt
            const loginStatus = await this._checkLoginStatus();

            // Update the account tab with new status
            if (this._view) {
              this._view.webview.postMessage({
                command: 'updateLoginStatus',
                loginStatus,
              });
            }

            if (success) {
              vscode.window.showInformationMessage(
                'You have been logged out successfully.'
              );
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Logout failed: ${error}`);
          }
          break;
        case 'checkLoginStatus':
          const status = await this._checkLoginStatus();
          webviewView.webview.postMessage({
            command: 'updateLoginStatus',
            loginStatus: status,
          });
          break;
        case 'refreshAnnotations':
          try {
            if (!this._metadata?.recordKey) {
              webviewView.webview.postMessage({
                command: 'annotationsError',
                error:
                  'No recordKey found in metadata. Please save metadata first.',
              });
              break;
            }

            const { getStoreState } = await initializeStateStore();
            const cellId = await getStoreState('cellId');

            if (!cellId?.cellId) {
              // No current cell, don't show error, just keep the prompt visible
              break;
            }

            const parsed = parseVerseReference(cellId.cellId);
            if (!parsed) {
              break;
            }

            const bookId = getBookId(parsed.book);
            if (!bookId) {
              l.warn('Could not find book ID for book code:', parsed.book);
              break;
            }

            const annotations = await loadAnnotations(
              this._context,
              this._metadata.recordKey,
              bookId,
              parsed.chapter
            );

            webviewView.webview.postMessage({
              command: 'updateAnnotations',
              annotations,
              bookId: bookId,
              chapterNumber: parsed.chapter,
              currentVerse: parsed.verse,
            });
          } catch (error) {
            webviewView.webview.postMessage({
              command: 'annotationsError',
              error: String(error),
            });
          }
          break;
        case 'loadAnnotations':
          try {
            if (!this._metadata?.recordKey) {
              webviewView.webview.postMessage({
                command: 'annotationsError',
                error:
                  'No recordKey found in metadata. Please save metadata first.',
              });
              break;
            }

            const { getStoreState, storeListener, updateStoreState } =
              await initializeStateStore();

            const cellId = await getStoreState('cellId');
            l.log('CELL ID: ', cellId);

            const verseRef = await getStoreState('verseRef' as any);
            l.log('VERSE REF: ', verseRef);

            const annotations = await loadAnnotations(
              this._context,
              this._metadata.recordKey,
              message.bookId,
              message.chapterNumber,
              message.group
            );

            webviewView.webview.postMessage({
              command: 'updateAnnotations',
              annotations,
              bookId: message.bookId,
              chapterNumber: message.chapterNumber,
            });
          } catch (error) {
            webviewView.webview.postMessage({
              command: 'annotationsError',
              error: String(error),
            });
          }
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
            .user-info-row {
                display: flex;
                align-items: center;
                margin-bottom: 8px;
            }
            .copy-button {
                margin-left: 8px;
                background: none;
                border: none;
                cursor: pointer;
                opacity: 0;
                transition: opacity 0.2s ease;
                padding: 2px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border-radius: 2px;
                width: 20px;
                height: 20px;
            }
            .copy-button:hover {
                background-color: var(--vscode-toolbar-hoverBackground);
            }
            .user-info-row:hover .copy-button {
                opacity: 1;
            }
            .copy-icon {
                width: 14px;
                height: 14px;
                fill: var(--vscode-foreground);
            }
            .annotation-item {
                border: 1px solid var(--vscode-input-border);
                border-radius: 4px;
                padding: 12px;
                margin-bottom: 12px;
                background-color: var(--vscode-input-background);
            }
            .annotation-item.highlighted {
                border: 2px solid var(--vscode-focusBorder);
                background-color: var(--vscode-list-activeSelectionBackground);
            }
            .annotation-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
            }
            .annotation-verse {
                font-weight: 600;
                color: var(--vscode-foreground);
            }
            .annotation-content {
                margin-top: 8px;
                line-height: 1.5;
            }
            .annotation-meta {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid var(--vscode-input-border);
            }
            .no-annotations {
                color: var(--vscode-descriptionForeground);
                font-style: italic;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="tabs">
                <button class="tab active" data-tab="upload">Upload</button>
                <button class="tab" data-tab="metadata">Metadata</button>
                <button class="tab" data-tab="annotations">Annotations</button>
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
                            <label for="id">ID:</label>
                            <input type="text" id="id" name="id" required>
                            <div class="helper-text">The unique identifier for the translation (e.g., "kjv", "niv")</div>
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
                        <div class="form-group">
                            <label for="shortName">Short Name:</label>
                            <input type="text" id="shortName" name="shortName" required>
                            <div class="helper-text">A short name for the translation (defaults to ID if not provided)</div>
                        </div>
                    </div>
                    
                    <div class="card">
                        <h3>Language Settings</h3>
                        <div class="form-group">
                            <label for="language">Language Code:</label>
                            <input type="text" id="language" name="language" required minlength="3" maxlength="3">
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
                        <button type="submit" id="saveMetadataBtn">Save Metadata</button>
                        <button type="button" id="reloadMetadataBtn">Reload</button>
                    </div>
                </form>
            </div>

            <div class="tab-content" id="annotations-tab">
                <h2>Translation Annotations</h2>
                <div id="annotations-prompt" class="card">
                    <h3>Select a verse to display annotations</h3>
                    <p>Annotations are automatically loaded based on the currently active verse or chapter in your editor.</p>
                    <p>Navigate to different verses in your translation files to view their associated annotations here.</p>
                </div>
                
                <div id="annotations-loading" class="card" style="display: none;">
                    <p>Loading annotations...</p>
                </div>
                
                <div id="annotations-error" class="card" style="display: none; background-color: var(--vscode-inputValidation-errorBackground);">
                    <h3>Error</h3>
                    <p id="annotations-error-message"></p>
                </div>
                
                <div id="annotations-result" class="card" style="display: none;">
                    <h3>Annotations for <span id="result-book-chapter"></span></h3>
                    <div id="annotations-list"></div>
                </div>
            </div>

            <div class="tab-content" id="account-tab">
                <h2>Account Status</h2>
                <div id="login-status-loading" class="card">
                    <p>Checking login status...</p>
                </div>
                
                <div id="logged-in-view" class="card" style="display: none;">
                    <h3>You are logged in</h3>
                    <div id="user-info">
                        <div class="user-info-row">
                            <p><strong>User ID:</strong> <span id="user-id">Loading...</span></p>
                            <button class="copy-button" id="copy-user-id-btn" title="Copy User ID">
                                <svg class="copy-icon" viewBox="0 0 16 16">
                                    <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
                                    <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
                                </svg>
                            </button>
                        </div>
                        <p><strong>Email:</strong> <span id="user-email">Loading...</span></p>
                        <p><strong>Session expires:</strong> <span id="session-expires">Loading...</span></p>
                    </div>
                    <div class="form-actions">
                        <button type="button" id="refresh-login-btn">Refresh Status</button>
                        <button type="button" id="logout-btn">Log Out</button>
                    </div>
                </div>
                
                <div id="logged-out-view" class="card" style="display: none;">
                    <h3>You are not logged in</h3>
                    <p>You need to log in to upload translations to the Seed Bible.</p>
                    
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
                    
                    // If switching to annotations tab, request current annotations
                    if (tabName === 'annotations') {
                        vscode.postMessage({
                            command: 'refreshAnnotations'
                        });
                    }
                });
            });
            
            // Initialize form with current metadata
            function updateFormWithMetadata(metadata) {
                document.getElementById('id').value = metadata.id || '';
                document.getElementById('name').value = metadata.name || '';
                document.getElementById('englishName').value = metadata.englishName || '';
                document.getElementById('shortName').value = metadata.shortName || metadata.id || '';
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
                        // Set session expiration
                        document.getElementById('session-expires').textContent = status.userInfo.sessionExpires || 'Unknown';
                        
                        // Set user ID
                        document.getElementById('user-id').textContent = status.userInfo.userId || 'Unknown';
                        
                        // Set email
                        document.getElementById('user-email').textContent = status.userInfo.email ||  'Unknown';
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
                        loginStatus = message.loginStatus;
                        updateLoginStatusUI(loginStatus);
                        break;
                    case 'updateAnnotations':
                        displayAnnotations(message.annotations, message.bookId, message.chapterNumber, message.currentVerse);
                        break;
                    case 'annotationsError':
                        displayAnnotationsError(message.error);
                        break;
                }
            });
            
            // Handle form submission
            document.getElementById('metadataForm').addEventListener('submit', (event) => {
                // Prevent the default form submission behavior
                event.preventDefault();
                
                // Form will be validated by HTML5 before this code runs
                const formData = {
                    id: document.getElementById('id').value,
                    name: document.getElementById('name').value,
                    englishName: document.getElementById('englishName').value,
                    shortName: document.getElementById('shortName').value,
                    language: document.getElementById('language').value?.toLowerCase(),
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
            
            // Handle logout button
            document.getElementById('logout-btn').addEventListener('click', () => {
                // Show loading view
                document.getElementById('login-status-loading').style.display = 'block';
                document.getElementById('logged-in-view').style.display = 'none';
                document.getElementById('logged-out-view').style.display = 'none';
                
                vscode.postMessage({
                    command: 'logout'
                });
            });
            
            // Handle copy user ID button
            document.getElementById('copy-user-id-btn').addEventListener('click', async () => {
                const userIdElement = document.getElementById('user-id');
                const userId = userIdElement.textContent;
                
                if (userId && userId !== 'Loading...' && userId !== 'Unknown') {
                    try {
                        await navigator.clipboard.writeText(userId);
                        
                        // Show a temporary visual feedback
                        const button = document.getElementById('copy-user-id-btn');
                        const originalTitle = button.title;
                        button.title = 'Copied!';
                        
                        // Reset the title after 2 seconds
                        setTimeout(() => {
                            button.title = originalTitle;
                        }, 2000);
                    } catch (err) {
                        console.error('Failed to copy user ID:', err);
                        // Fallback for older browsers or when clipboard API is not available
                        const textArea = document.createElement('textarea');
                        textArea.value = userId;
                        document.body.appendChild(textArea);
                        textArea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textArea);
                    }
                }
            });
            
            // Handle ID change to update shortName if empty or matching the ID
            document.getElementById('id').addEventListener('input', (event) => {
                const idField = event.target;
                const shortNameField = document.getElementById('shortName');
                
                // Update shortName only if it's empty or was the same as the previous ID
                if (!shortNameField.value || shortNameField.value === idField.dataset.previousValue) {
                    shortNameField.value = idField.value;
                }
                
                // Store the current ID value for future comparison
                idField.dataset.previousValue = idField.value;
            });
            
            // Initialize the previous value
            const idField = document.getElementById('id');
            idField.dataset.previousValue = idField.value;
            
            // Handle shortName blur to reset to ID if empty
            document.getElementById('shortName').addEventListener('blur', (event) => {
                const shortNameField = event.target;
                if (!shortNameField.value) {
                    const idField = document.getElementById('id');
                    shortNameField.value = idField.value;
                }
            });
            
            // Function to display annotations
            function displayAnnotations(annotations, bookId, chapterNumber, currentVerse) {
                // Hide loading, error, and prompt
                document.getElementById('annotations-loading').style.display = 'none';
                document.getElementById('annotations-error').style.display = 'none';
                document.getElementById('annotations-prompt').style.display = 'none';
                
                // Show result
                const resultDiv = document.getElementById('annotations-result');
                resultDiv.style.display = 'block';
                
                // Update header
                document.getElementById('result-book-chapter').textContent = \`\${bookId} \${chapterNumber}\`;
                
                // Display annotations
                const listDiv = document.getElementById('annotations-list');
                
                if (!annotations || annotations.length === 0) {
                    listDiv.innerHTML = '<p class="no-annotations">No annotations found for this chapter.</p>';
                    return;
                }
                
                // Sort annotations by verse number and order
                annotations.sort((a, b) => {
                    if (a.verseNumber !== b.verseNumber) {
                        return (a.verseNumber || 0) - (b.verseNumber || 0);
                    }
                    return (a.order || 0) - (b.order || 0);
                });
                
                listDiv.innerHTML = annotations.map(annotation => {
                    const verseRef = annotation.endVerseNumber 
                        ? \`\${annotation.verseNumber}-\${annotation.endVerseNumber}\`
                        : annotation.verseNumber || 'Chapter';
                    
                    const content = annotation.data.type === 'comment' 
                        ? annotation.data.html 
                        : JSON.stringify(annotation.data);
                    
                    const createdDate = annotation.data.createdAtMs 
                        ? new Date(annotation.data.createdAtMs).toLocaleString()
                        : 'Unknown';
                    
                    const updatedDate = annotation.data.updatedAtMs 
                        ? new Date(annotation.data.updatedAtMs).toLocaleString()
                        : null;
                    
                    // Check if this annotation should be highlighted
                    const isHighlighted = currentVerse && 
                        currentVerse >= annotation.verseNumber && 
                        currentVerse <= (annotation.endVerseNumber ?? annotation.verseNumber);
                    
                    const highlightClass = isHighlighted ? ' highlighted' : '';
                    
                    return \`
                        <div class="annotation-item\${highlightClass}">
                            <div class="annotation-header">
                                <span class="annotation-verse">Verse \${verseRef}</span>
                                <span>\${annotation.data.type}</span>
                            </div>
                            <div class="annotation-content">\${content}</div>
                            <div class="annotation-meta">
                                <div>ID: \${annotation.id}</div>
                                <div>Created: \${createdDate}</div>
                                \${updatedDate ? \`<div>Updated: \${updatedDate}</div>\` : ''}
                                \${annotation.data.replyTo ? \`<div>Reply to: \${annotation.data.replyTo}</div>\` : ''}
                            </div>
                        </div>
                    \`;
                }).join('');
                
                // Scroll to the first highlighted annotation
                setTimeout(() => {
                    const firstHighlighted = listDiv.querySelector('.annotation-item.highlighted');
                    if (firstHighlighted) {
                        firstHighlighted.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 100);
            }
            
            // Function to display annotations error
            function displayAnnotationsError(error) {
                // Hide loading, result, and prompt
                document.getElementById('annotations-loading').style.display = 'none';
                document.getElementById('annotations-result').style.display = 'none';
                document.getElementById('annotations-prompt').style.display = 'none';
                
                // Show error
                const errorDiv = document.getElementById('annotations-error');
                errorDiv.style.display = 'block';
                document.getElementById('annotations-error-message').textContent = error;
            }
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
  private async _saveMetadata(metadata: SeedBibleMetadata): Promise<void> {
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
  private _getDefaultMetadata(): SeedBibleMetadata {
    return {
      website: '',
      licenseUrl: '',
      id: '',
      name: '',
      englishName: '',
      shortName: '',
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
      const client = await getClient(this._context, false);

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
      return {
        isLoggedIn: true,
        userInfo: {
          sessionExpires: new Date(expiration).toLocaleString(),
          userId: userId,
          name: info.success ? info.name : null,
          email: info.success ? info.email : null,
          displayName: info.success ? info.displayName : null,
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
