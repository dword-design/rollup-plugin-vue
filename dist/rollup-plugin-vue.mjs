import { createFilter } from 'rollup-pluginutils';
import { stringify, parse } from 'querystring';
import { basename, resolve, dirname } from 'path';
import { createDefaultCompiler, assemble } from '@vue/component-compiler';
import MagicString from 'magic-string';
import { parse as parse$1 } from '@vue/component-compiler-utils';
import debug from 'debug';

/*! *****************************************************************************
Copyright (c) Microsoft Corporation. All rights reserved.
Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at http://www.apache.org/licenses/LICENSE-2.0

THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
MERCHANTABLITY OR NON-INFRINGEMENT.

See the Apache Version 2.0 License for specific language governing permissions
and limitations under the License.
***************************************************************************** */

function __awaiter(thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve$$1, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve$$1(result.value) : new P(function (resolve$$1) { resolve$$1(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

const GET_QUERY = /\.vue(\.[a-z]+?)?\?(.+)$/i;
const PARAM_NAME = 'rollup-plugin-vue';
function createVueFilter(include = [/\.vue$/i], exclude = []) {
    const filter = createFilter(include, exclude);
    return id => filter(id);
}
function getVueMetaFromQuery(id) {
    const match = GET_QUERY.exec(id);
    if (match) {
        const query = parse(match[2]);
        if (PARAM_NAME in query) {
            const data = (Array.isArray(query[PARAM_NAME])
                ? query[PARAM_NAME][0]
                : query[PARAM_NAME]);
            const [type, index, lang] = data.split('.');
            return (lang
                ? { type, lang, index: parseInt(index) } // styles.0.css
                : { type, lang: index }); // script.js
        }
    }
    return null;
}
function isVuePartRequest(id) {
    return getVueMetaFromQuery(id) !== null;
}
const createVuePartRequest = ((filename, lang, type, index) => {
    lang = lang || createVuePartRequest.defaultLang[type];
    const match = GET_QUERY.exec(filename);
    const query = match ? parse(match[2]) : {};
    query[PARAM_NAME] = [type, index, lang]
        .filter(it => it !== undefined)
        .join('.');
    return `${basename(filename)}?${stringify(query)}`;
});
createVuePartRequest.defaultLang = {
    template: 'html',
    styles: 'css',
    script: 'js'
};
function parseVuePartRequest(id) {
    if (!id.includes('.vue'))
        return;
    const filename = id.substr(0, id.lastIndexOf('.vue') + 4);
    const params = getVueMetaFromQuery(id);
    if (params === null)
        return;
    return {
        filename,
        meta: params
    };
}
function resolveVuePart(descriptors, { filename, meta }) {
    const descriptor = descriptors.get(filename);
    if (!descriptor)
        throw Error('File not processed yet, ' + filename);
    const blocks = descriptor[meta.type];
    const block = Array.isArray(blocks) ? blocks[meta.index] : blocks;
    if (!block)
        throw Error(`Requested (type=${meta.type} & index=${meta.index}) block not found in ${filename}`);
    return block;
}
function transformRequireToImport(code) {
    const imports = {};
    let strImports = '';
    code = code.replace(/require\(("(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)+')\)/g, (_, name) => {
        if (!(name in imports)) {
            imports[name] = `__$_require_${name
                .replace(/[^a-z0-9]/g, '_')
                .replace(/_{2,}/g, '_')
                .replace(/^_|_$/g, '')}__`;
            strImports += 'import ' + imports[name] + ' from ' + name + '\n';
        }
        return imports[name];
    });
    return strImports + code;
}

const templateCompiler = require('vue-template-compiler');
const hash = require('hash-sum');
const { version } = require('../package.json');
const d = debug('rollup-plugin-vue');
const dR = debug('rollup-plugin-vue:resolve');
const dL = debug('rollup-plugin-vue:load');
const dT = debug('rollup-plugin-vue:transform');
/**
 * Rollup plugin for handling .vue files.
 */
function vue(opts = {}) {
    const isVue = createVueFilter(opts.include, opts.exclude);
    const isProduction = opts.template && typeof opts.template.isProduction === 'boolean'
        ? opts.template.isProduction
        : process.env.NODE_ENV === 'production' ||
            process.env.BUILD === 'production';
    d('Version ' + version);
    d(`Build environment: ${isProduction ? 'production' : 'development'}`);
    d(`Build target: ${process.env.VUE_ENV || 'browser'}`);
    if (!opts.normalizer)
        opts.normalizer = '~' + 'vue-runtime-helpers/dist/normalize-component.mjs';
    if (!opts.styleInjector)
        opts.styleInjector =
            '~' + 'vue-runtime-helpers/dist/inject-style/browser.mjs';
    if (!opts.styleInjectorSSR)
        opts.styleInjectorSSR =
            '~' + 'vue-runtime-helpers/dist/inject-style/server.mjs';
    if (!opts.styleInjectorShadow)
        opts.styleInjectorShadow =
            '~' + 'vue-runtime-helpers/dist/inject-style/shadow.mjs';
    createVuePartRequest.defaultLang = Object.assign({}, createVuePartRequest.defaultLang, opts.defaultLang);
    const shouldExtractCss = opts.css === false;
    const customBlocks = [];
    if (opts.blackListCustomBlocks) {
        console.warn('`blackListCustomBlocks` option is deprecated use `customBlocks`. See https://rollup-plugin-vue.vuejs.org/options.html#customblocks.');
        customBlocks.push(...opts.blackListCustomBlocks.map(tag => '!' + tag));
    }
    if (opts.whiteListCustomBlocks) {
        console.warn('`whiteListCustomBlocks` option is deprecated use `customBlocks`. See https://rollup-plugin-vue.vuejs.org/options.html#customblocks.');
        customBlocks.push(...opts.whiteListCustomBlocks);
    }
    const isAllowed = createCustomBlockFilter(opts.customBlocks || customBlocks);
    const beforeAssemble = opts.beforeAssemble ||
        ((d) => d);
    const exposeFilename = typeof opts.exposeFilename === 'boolean' ? opts.exposeFilename : false;
    const data = (opts.data || {});
    delete opts.data;
    delete opts.beforeAssemble;
    delete opts.css;
    delete opts.exposeFilename;
    delete opts.customBlocks;
    delete opts.blackListCustomBlocks;
    delete opts.whiteListCustomBlocks;
    delete opts.defaultLang;
    delete opts.include;
    delete opts.exclude;
    opts.template = Object.assign({ transformAssetUrls: {
            video: ['src', 'poster'],
            source: 'src',
            img: 'src',
            image: 'xlink:href'
        } }, opts.template);
    if (opts.template && typeof opts.template.isProduction === 'undefined') {
        opts.template.isProduction = isProduction;
    }
    const descriptors = new Map();
    if (opts.css === false)
        d('Running in CSS extract mode');
    const getCompiler = ({ scopeId }) => {
        const options = Object.assign({}, opts);
        options.template = Object.assign({}, options.template, { compilerOptions: Object.assign({}, (options.template.compilerOptions
                ? options.template.compilerOptions
                : {}), { scopeId: scopeId }) });
        return createDefaultCompiler(options);
    };
    function prependStyle(id, lang, code, map) {
        if (!(lang in data))
            return { code };
        const ms = new MagicString(code, {
            filename: id,
            indentExclusionRanges: []
        });
        const value = data[lang];
        const fn = typeof value === 'function' ? value : () => value;
        ms.prepend(fn());
        return { code: ms.toString() };
    }
    return {
        name: 'VuePlugin',
        resolveId(id, importer) {
            const request = id;
            if (id.startsWith('vue-runtime-helpers/')) {
                id = require.resolve(id);
                dR(`form: ${request} \nto: ${id}\n`);
                return id;
            }
            if (!isVuePartRequest(id))
                return;
            id = resolve(dirname(importer), id);
            const ref = parseVuePartRequest(id);
            if (ref) {
                const element = resolveVuePart(descriptors, ref);
                const src = element.src;
                if (ref.meta.type !== 'styles' && typeof src === 'string') {
                    if (src.startsWith('.')) {
                        return resolve(dirname(ref.filename), src);
                    }
                    else {
                        return require.resolve(src, {
                            paths: [dirname(ref.filename)]
                        });
                    }
                }
                dR(`from: ${request} \nto: ${id}\n`);
                return id;
            }
        },
        load(id) {
            const request = parseVuePartRequest(id);
            if (!request)
                return null;
            const element = resolveVuePart(descriptors, request);
            let code = 'code' in element
                ? element.code // .code is set when extract styles is used. { css: false }
                : element.content;
            let map = element.map;
            if (request.meta.type === 'styles') {
                code = prependStyle(id, request.meta.lang, code, map).code;
            }
            dL(`id: ${id}\ncode: \n${code}\nmap: ${JSON.stringify(map, null, 2)}\n\n`);
            return { code, map };
        },
        transform(source, filename) {
            return __awaiter(this, void 0, void 0, function* () {
                if (isVue(filename)) {
                    // Create deep copy to prevent issue during watching changes.
                    const descriptor = JSON.parse(JSON.stringify(parse$1({
                        filename,
                        source,
                        compiler: opts.compiler || templateCompiler,
                        compilerParseOptions: opts.compilerParseOptions,
                        sourceRoot: opts.sourceRoot,
                        needMap: 'needMap' in opts ? opts.needMap : true
                    })));
                    descriptors.set(filename, descriptor);
                    const scopeId = 'data-v-' +
                        (isProduction
                            ? hash(basename(filename) + source)
                            : hash(filename + source));
                    const hasScopedStyles = descriptor.styles.some(style => !!style.scoped);
                    const compiler = getCompiler({
                        scopeId: hasScopedStyles ? scopeId : undefined
                    });
                    const styles = yield Promise.all(descriptor.styles.map((style) => __awaiter(this, void 0, void 0, function* () {
                        if (style.content) {
                            style.content = prependStyle(filename, style.lang || 'css', style.content, style.map).code;
                        }
                        const compiled = yield compiler.compileStyleAsync(filename, scopeId, style);
                        if (compiled.errors.length > 0)
                            throw Error(compiled.errors[0]);
                        return compiled;
                    })));
                    const input = {
                        scopeId,
                        styles,
                        customBlocks: []
                    };
                    if (descriptor.template) {
                        input.template = compiler.compileTemplate(filename, descriptor.template);
                        input.template.code = transformRequireToImport(input.template.code);
                        if (input.template.errors && input.template.errors.length) {
                            input.template.errors.map((error) => this.error(error));
                        }
                        if (input.template.tips && input.template.tips.length) {
                            input.template.tips.map((message) => this.warn({ message }));
                        }
                    }
                    input.script = descriptor.script
                        ? {
                            code: `
            export * from '${createVuePartRequest(filename, descriptor.script.lang || 'js', 'script')}'
            import script from '${createVuePartRequest(filename, descriptor.script.lang || 'js', 'script')}'
            export default script
            ${exposeFilename
                                ? `
            // For security concerns, we use only base name in production mode. See https://github.com/vuejs/rollup-plugin-vue/issues/258
            script.__file = ${isProduction
                                    ? JSON.stringify(basename(filename))
                                    : JSON.stringify(filename)}`
                                : ''}
            `
                        }
                        : { code: '' };
                    if (shouldExtractCss) {
                        input.styles = input.styles
                            .map((style, index) => {
                            descriptor.styles[index].code = style.code;
                            input.script.code +=
                                '\n' +
                                    `import '${createVuePartRequest(filename, 'css', 'styles', index)}'`;
                            if (style.module || descriptor.styles[index].scoped) {
                                return Object.assign({}, style, { code: '', map: undefined });
                            }
                        })
                            .filter(Boolean);
                    }
                    input.script.code = input.script.code.replace(/^\s+/gm, '');
                    const result = assemble(compiler, filename, beforeAssemble(input), opts);
                    descriptor.customBlocks.forEach((block, index) => {
                        if (!isAllowed(block.type))
                            return;
                        result.code +=
                            '\n' +
                                `export * from '${createVuePartRequest(filename, (typeof block.attrs.lang === 'string' && block.attrs.lang) ||
                                    createVuePartRequest.defaultLang[block.type] ||
                                    block.type, 'customBlocks', index)}'`;
                    });
                    dT(`id: ${filename}\ncode:\n${result.code}\n\nmap:\n${JSON.stringify(result.map, null, 2)}\n`);
                    result.map = result.map || { mappings: '' };
                    return result;
                }
            });
        }
    };
}
function createCustomBlockFilter(customBlocks) {
    if (typeof customBlocks === 'function')
        return customBlocks;
    if (!Array.isArray(customBlocks))
        return () => false;
    const allowed = new Set(customBlocks.filter(tag => !tag.startsWith('!')));
    const notAllowed = new Set(customBlocks.filter(tag => tag.startsWith('!')).map(tag => tag.substr(1)));
    return tag => {
        if (allowed.has(tag))
            return true;
        if (notAllowed.has(tag))
            return false;
        if (notAllowed.has('*'))
            return false;
        return allowed.has('*');
    };
}

export default vue;
//# sourceMappingURL=rollup-plugin-vue.mjs.map