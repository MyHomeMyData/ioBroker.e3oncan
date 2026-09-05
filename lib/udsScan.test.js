'use strict';

const { expect } = require('@iobroker/testing/node_modules/chai');
const { collectIdsFromDevices } = require('./udsScan');

describe('udsScan.js => collectIdsFromDevices()', () => {
    it('returns an empty set for no devices', () => {
        expect(collectIdsFromDevices([])).to.deep.equal(new Set());
    });

    it('returns an empty set for undefined/null input', () => {
        expect(collectIdsFromDevices(undefined)).to.deep.equal(new Set());
        // @ts-expect-error deliberately testing the null case too, not just undefined
        expect(collectIdsFromDevices(null)).to.deep.equal(new Set());
    });

    it('collects a single numeric collectCanId per device', () => {
        const table = [{ collectCanId: '0x693' }, { collectCanId: '0x451' }];
        expect(collectIdsFromDevices(table)).to.deep.equal(new Set([0x693, 0x451]));
    });

    it('splits a comma-separated collectCanId into multiple IDs', () => {
        const table = [{ collectCanId: '0x451,0x441' }];
        expect(collectIdsFromDevices(table)).to.deep.equal(new Set([0x451, 0x441]));
    });

    it('ignores devices with an empty collectCanId', () => {
        const table = [{ collectCanId: '' }, { collectCanId: '0x693' }];
        expect(collectIdsFromDevices(table)).to.deep.equal(new Set([0x693]));
    });

    it('ignores non-numeric and non-positive entries in the comma list', () => {
        const table = [{ collectCanId: '0x693,not-a-number,0,-5' }];
        expect(collectIdsFromDevices(table)).to.deep.equal(new Set([0x693]));
    });

    it('deduplicates the same ID reported by multiple devices', () => {
        const table = [{ collectCanId: '0x693' }, { collectCanId: '0x693' }];
        expect(collectIdsFromDevices(table)).to.deep.equal(new Set([0x693]));
    });

    it('tolerates stray whitespace around comma-separated IDs', () => {
        const table = [{ collectCanId: ' 0x693 , 0x451 ' }];
        expect(collectIdsFromDevices(table)).to.deep.equal(new Set([0x693, 0x451]));
    });
});
