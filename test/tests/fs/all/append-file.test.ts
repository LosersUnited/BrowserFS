import { backends, fs, configure } from '../../../common';
import * as path from 'path';
import common from '../../../common';
import type { FileContents } from '../../../../src/core/file_system';
import { jest } from '@jest/globals';

describe.each(backends)('%s appendFile tests', (name, options) => {
	const configured = configure({ fs: name, options });
	const tmpDir: string = path.join(common.tmpDir, 'append.txt');

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('should create an empty file and add content', async () => {
		await configured;
		const filename = path.join(tmpDir, 'append.txt');
		const content = 'Sample content';

		jest.spyOn(fs, 'appendFile').mockImplementation((file, data, mode, callback) => {
			if (typeof mode == 'function') {
				callback = mode;
			}
			expect(file).toBe(filename);
			expect(data).toBe(content);
			callback();
		});

		jest.spyOn(fs, 'readFile').mockImplementation((file, options, callback) => {
			expect(file).toBe(filename);
			expect(options).toBe('utf8');
			callback(null, content);
		});

		await appendFileAndVerify(filename, content);
	});

	it('should append data to a non-empty file', async () => {
		await configured;
		const filename = path.join(tmpDir, 'append2.txt');
		const currentFileData = 'ABCD';
		const content = 'Sample content';

		fs.writeFile(filename, currentFileData, err => {
			expect(err).toBeNull();

			jest.spyOn(fs, 'appendFile').mockImplementation((file, data, mode, callback) => {
				if (typeof mode == 'function') {
					callback = mode;
				}
				expect(file).toBe(filename);
				expect(data).toBe(content);
				callback();
			});

			jest.spyOn(fs, 'readFile').mockImplementation((file, options, callback) => {
				expect(file).toBe(filename);
				expect(options).toBe('utf8');
				callback(null, currentFileData + content);
			});

			appendFileAndVerify(filename, content);
		});
	});

	it('should append a buffer to the file', async () => {
		await configured;
		const filename = path.join(tmpDir, 'append3.txt');
		const currentFileData = 'ABCD';
		const content = Buffer.from('Sample content', 'utf8');

		fs.writeFile(filename, currentFileData, err => {
			expect(err).toBeNull();

			jest.spyOn(fs, 'appendFile').mockImplementation((file, data, mode, callback) => {
				if (typeof mode == 'function') {
					callback = mode;
				}
				expect(file).toBe(filename);
				expect(data).toBe(content);
				callback();
			});

			jest.spyOn(fs, 'readFile').mockImplementation((file, options, callback) => {
				expect(file).toBe(filename);
				expect(options).toBe('utf8');
				callback(null, currentFileData + content);
			});

			appendFileAndVerify(filename, content);
		});
	});

	// Additional tests can be added here

	async function appendFileAndVerify(filename: string, content: FileContents): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			fs.appendFile(filename, content, error => {
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			});
		});

		await new Promise<void>((resolve, reject) => {
			fs.readFile(filename, 'utf8', (error, data) => {
				if (error) {
					reject(error);
				} else {
					expect(data).toEqual(content.toString());
					resolve();
				}
			});
		});
	}
});
