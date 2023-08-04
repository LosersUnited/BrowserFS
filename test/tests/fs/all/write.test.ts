import { backends, fs, configure } from '../../../common';
import * as path from 'path';
import common from '../../../common';

describe.each(backends)('%s Asynchronous File Writing', (name, options) => {
	const configured = configure({ fs: name, options });
	it('should write file asynchronously with specified content', async done => {
		await configured;
		if (fs.getRootFS().isReadOnly()) {
			done();
			return;
		}

		const fn = path.join(common.tmpDir, 'write.txt');
		const fn2 = path.join(common.tmpDir, 'write2.txt');
		const expected = 'ümlaut.';

		fs.open(fn, 'w', 0o644, function (err, fd) {
			if (err) throw err;
			fs.write(fd, '', 0, 'utf8', function (err, written) {
				expect(written).toBe(0);
			});
			fs.write(fd, expected, 0, 'utf8', function (err, written) {
				if (err) throw err;
				expect(written).toBe(Buffer.byteLength(expected));
				fs.close(fd, function (err) {
					if (err) throw err;
					fs.readFile(fn, 'utf8', function (err, data) {
						if (err) throw err;
						expect(data).toBe(expected);
						fs.unlink(fn, function (err) {
							if (err) throw err;
							done();
						});
					});
				});
			});
		});

		fs.open(fn2, 'w', 0o644, function (err, fd) {
			if (err) throw err;
			fs.write(fd, '', 0, 'utf8', function (err, written) {
				expect(written).toBe(0);
			});
			fs.write(fd, expected, 0, 'utf8', function (err, written) {
				if (err) throw err;
				expect(written).toBe(Buffer.byteLength(expected));
				fs.close(fd, function (err) {
					if (err) throw err;
					fs.readFile(fn2, 'utf8', function (err, data) {
						if (err) throw err;
						expect(data).toBe(expected);
						fs.unlink(fn2, function (err) {
							if (err) throw err;
							done();
						});
					});
				});
			});
		});
	});
});
