// eslint.config.js
// See "Globally ignoring files with ignores" at https://eslint.org/docs/latest/use/configure/configuration-files
//export default [
//    {
//        ignores: ["**/.eslintrc.js", "admin/words.js"]
//    }
//];
// ioBroker eslint template configuration file for js and ts files
// Please note that esm or react based modules need additional modules loaded.
import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        // specify files to exclude from linting here
        ignores: [
            '.dev-server/',
            '.vscode/',
            '*.test.js',
            'test/**/*.js',
            '*.config.mjs',
            'build',
            'dist',
            'admin/build', 
            'admin/words.js',
            'admin/admin.d.ts',
            'admin/blockly.js',
            'lib/*.test.js',
            '**/adapter-config.d.ts',
        ],
    },
    {
        // you may disable some 'jsdoc' warnings - but using jsdoc is highly recommended
        // as this improves maintainability. jsdoc warnings will not block buiuld process.
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns-description': 'off',
            'jsdoc/require-returns-check': 'off',
        },
    },
];

