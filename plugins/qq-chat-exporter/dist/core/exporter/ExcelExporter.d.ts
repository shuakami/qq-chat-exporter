import { BaseExporter, ExportOptions } from './BaseExporter.js';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';
export declare class ExcelExporter extends BaseExporter {
    constructor(options: ExportOptions, excelOptions?: any, core?: NapCatCore);
}
