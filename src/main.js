import playwright from 'playwright';
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import path from 'path';
import fs from 'node:fs';

import loggingSetup from './logging.js'

/**
 * @typedef utilFunctions Utility functions
 * @type { object }
 * @property { (question: string, timeout: number) => Promise<string> } askUser Ask user for input
 * @property { (page: playwright.Page, prefix: string) => Promise<void> } takeScreenshot take a screenshot
 * @property { (page: playwright.Page, additionalWaitTimeSeconds: number) => Promise<void> } waitEntirePageToLoad wait page to load
 */

/**
 * @typedef configurations Configurations to run the automation
 * @type { object }
 * @property { boolean } DEMO_MODE
 */

/**
 * User must set DEMO_MODE to false explicitly in .env file to send real messages.
 * If DEMO_MODE is not set or set to true, it will only log actions without sending messages, and log color will be green.
 * Useful for testing purposes without affecting real conversations.
 */
const DEMO_MODE = (process.env.DEMO_MODE !== 'false');

const LOGS_FOLDER_PATH = (process.env.LOGS_FOLDER_PATH || 'data/logs') + '/';
const SCREENSHOT_FOLDER_PATH = (process.env.SCREENSHOT_FOLDER_PATH || 'data/screenshots') + '/';

const BASE_URL = process.env.BASE_URL ? process.env.BASE_URL + '/' : null;
const DEFAULT_ADDITIONAL_WAIT_TIME_SECONDS = parseInt(process.env.DEFAULT_ADDITIONAL_WAIT_TIME_SECONDS, 10) || 3;
const QUESTION_TIMEOUT_SECONDS = parseInt(process.env.QUESTION_TIMEOUT_SECONDS, 10) || 30;
const USER_AGENT = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3';
const USER_DATA_DIR = process.env.USER_DATA_DIR;

const readlineInterface = readline.createInterface({ input, output });

/**
 * Setup all required configurations before start processing
 */
const setup = async () => {
  console.log('Starting Setup...');

  assertFolderPathValue(LOGS_FOLDER_PATH, 'LOGS_FOLDER_PATH');

  loggingSetup(DEMO_MODE, LOGS_FOLDER_PATH);

  assertFolderPathValue(SCREENSHOT_FOLDER_PATH, 'SCREENSHOT_FOLDER_PATH');

  assertEnvVariableValue(BASE_URL, 'BASE_URL');
  assertEnvVariableValue(USER_AGENT, 'USER_AGENT');
  assertEnvVariableValue(DEFAULT_ADDITIONAL_WAIT_TIME_SECONDS, 'DEFAULT_ADDITIONAL_WAIT_TIME_SECONDS');
  assertEnvVariableValue(USER_DATA_DIR, 'USER_DATA_DIR', false);

  console.log('Setup completed successfully.');
}

/**
 * Check if environment variable is defined or throw an error
 * @param {string} envVariableValue The environment variable value
 * @param { string } envVariableName
 * @param { boolean } required
 */
const assertEnvVariableValue = (envVariableValue, envVariableName, required = true) => {
  if (!envVariableValue && required) {
    throw new Error(`${envVariableName} environment variable is not set.`);
  }

  if (envVariableValue) {
    console.log(`${envVariableName} is set to: ${envVariableValue}`);
  } else {
    console.log(`${envVariableName} is not set`);
  }
}

/**
 * Check folder path value and create folders if does not exist
 * @param {string} folderPathValue Folder path to check
 * @param { string } folderPathName
 */
const assertFolderPathValue = (folderPathValue, folderPathName) => {
  if (!folderPathValue) {
    throw new Error(`${folderPathName} is not set.`);
  } else if (!(fs.existsSync(folderPathValue))) {
    fs.mkdirSync(folderPathValue, { recursive: true });
  }
  console.log(`${folderPathName} is set to ${folderPathValue} `);
}

/**
 * @callback processingCallback
 * @param { playwright.Page }
 * @param { utilFunctions  }
 * @returns { Promise<void> }
 */

/**
 * Run main automation
 * @param { processingCallback } processing The concrete automated tasks to run
 * @returns { Promise<void> }
 */
const main = async (processing) => {
  let context;
  let page;

  try {
    console.log('\n\n **** Starting ****');
    await setup();

    const options = {
      headless: false,
      viewport: null,
      args: ['--start-maximized'],
      userAgent: USER_AGENT,
    };

    if (USER_DATA_DIR) {
      context = await playwright.chromium.launchPersistentContext(USER_DATA_DIR, options);
    } else {
      context = await playwright.chromium.launch(options);
    }

    page = await context.newPage();

    await page.goto(BASE_URL);
    await waitEntirePageToLoad(page);

    const utilFunctions = { askUser, takeScreenshot, waitEntirePageToLoad };
    await processing(page, utilFunctions);

    console.log('Finishing...');

  } catch (error) {
    console.error('Error occurred while processing visitors:', error);
    await takeScreenshot(page, 'error');

  } finally {
    console.log('Closing resources...');
    readlineInterface.close();
    await page.close();
    await context.close();
    console.log('**** Done **** ');
    process.exit(0);
  }
}

/**
 * Take screenshot of the current web page
 * @param {playwright.Page} page The reference to the web page
 * @param {string} prefix Possible prefix to add to the screenshot file name
 */
const takeScreenshot = async (page, prefix = '') => {
  const isoDateTime = new Date().toISOString().replace(/[:.]/g, '-');
  const demoLabel = DEMO_MODE ? 'DEMO-' : '';
  prefix = prefix ? prefix + '-' : prefix;
  const screenshotFileName = `${demoLabel}${prefix}screenshot-${isoDateTime}.png`;
  await page.screenshot({ path: path.join(SCREENSHOT_FOLDER_PATH, screenshotFileName) });

  console.log(`Screenshot taken: ${screenshotFileName}`);
};

/**
 * Prompt a question to the user and wait for the answer
 * @param {string} question Question to ask to the user
 * @param {number} timeout Wait time for user input before throwing an error
 * @returns {string} User input
 */
const askUser = async (question, timeout = QUESTION_TIMEOUT_SECONDS) => {
  const abortController = new AbortController();
  const signal = abortController.signal;
  let userAnswer;

  signal.addEventListener('abort', () => {
    abortController.abort();
    throw new Error('The question timed out...');
  }, { once: true });

  setTimeout(() => {
    if (!userAnswer) {
      abortController.abort();
    }
  }, 1000 * timeout);

  return new Promise((resolve) => {
    readlineInterface.question(question, { signal }, (answer) => {
      userAnswer = answer;
      resolve(answer)
    })
  });
};

/**
 * Wait of the web page to load, we wait for the following event : domcontentloaded, load and networkidle
 * @param {playwright.Page} page The reference to the web page
 * @param {number} additionalWaitTimeSeconds Additional time to wait after the page is loaded
 */
const waitEntirePageToLoad = async (page, additionalWaitTimeSeconds = DEFAULT_ADDITIONAL_WAIT_TIME_SECONDS) => {
  console.time('Page fully loaded.');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000 * additionalWaitTimeSeconds);
  console.timeEnd('Page fully loaded.');
};

process.on('uncaughtException', function (err) {
  readlineInterface.close();
  console.error(err);
})


export { main, askUser, waitEntirePageToLoad, takeScreenshot };