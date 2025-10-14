/* frac.js (C) 2012-present SheetJS -- http://sheetjs.com */
// TypeScript Version: 2.2

export interface Frac$Module {
	(x: number, D: number, mixed?: boolean): [number, number, number];
	cont(x: number, D: number, mixed?: boolean): [number, number, number];
}
export const frac: Frac$Module;
export default frac;
