/**
 * Default snapshot generators for Univer documents (Sheet, Doc, Slide).
 * Matches the official @univerjs-pro/collaboration protocol ISnapshot structures.
 */

export const DEFAULT_SHEET_ORIGINAL_META = btoa(JSON.stringify({
  tabColor: "",
  hidden: 0,
  zoomRatio: 1,
  freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
  scrollTop: 0,
  scrollLeft: 0,
  defaultColumnWidth: 88,
  defaultRowHeight: 24,
  mergeData: [],
  rowData: {},
  columnData: {},
  showGridlines: 1,
  rowHeader: { width: 46, hidden: 0 },
  columnHeader: { height: 20, hidden: 0 },
  rightToLeft: 0
}));

export const DEFAULT_WORKBOOK_ORIGINAL_META = btoa(JSON.stringify({
  appVersion: "1.0.0-insiders.20260907-70fc579",
  locale: "enUS",
  dateSystem: "date1900",
  styles: {}
}));

export const DEFAULT_DOC_ORIGINAL_META = btoa(JSON.stringify({
  locale: "enUS",
  tableSource: {},
  drawings: {},
  drawingsOrder: [],
  headers: {},
  footers: {},
  body: {
    dataStream: "\r\n",
    textRuns: [],
    customBlocks: [],
    tables: [],
    columnGroups: [],
    blockRanges: [],
    customRanges: [],
    customDecorations: [],
    paragraphs: [
      {
        startIndex: 0,
        paragraphId: "para_init_default",
        paragraphStyle: {}
      }
    ],
    sectionBreaks: [
      {
        sectionId: "section_init_default",
        startIndex: 1
      }
    ]
  },
  documentStyle: {
    pageSize: { width: 960, height: 1122.6666666666667 },
    documentFlavor: 2,
    marginTop: 50,
    marginBottom: 50,
    marginRight: 50,
    marginLeft: 50,
    autoHyphenation: 1,
    doNotHyphenateCaps: 0,
    consecutiveHyphenLimit: 2,
    defaultHeaderId: "",
    defaultFooterId: "",
    evenPageHeaderId: "",
    evenPageFooterId: "",
    firstPageHeaderId: "",
    firstPageFooterId: "",
    evenAndOddHeaders: 0,
    useFirstPageHeaderFooter: 0,
    marginHeader: 30,
    marginFooter: 30,
    defaultParagraphStyle: {
      spaceAbove: { v: 0 },
      lineSpacing: 1.5,
      spaceBelow: { v: 12 }
    },
    renderConfig: {
      zeroWidthParagraphBreak: 0,
      vertexAngle: 0,
      centerAngle: 0,
      background: { rgb: "#ccc" }
    }
  },
  settings: {}
}));

export const DEFAULT_SLIDE_ORIGINAL_META = "eyJhcHBWZXJzaW9uIjoiMS4wLjAtaW5zaWRlcnMuMjAyNjA5MDctNzBmYzU3OSIsImxvY2FsZSI6ImVuVVMiLCJkZWZhdWx0UGFnZVNpemUiOnsid2lkdGgiOjk2MCwiaGVpZ2h0Ijo1NDB9LCJzbGlkZU9yZGVyIjpbInNsaWRlLTEiXSwic2xpZGVzIjp7InNsaWRlLTEiOnsiaWQiOiJzbGlkZS0xIiwicGFnZVR5cGUiOiJzbGlkZSIsInRpdGxlIjoiU2xpZGUgMSIsImVsZW1lbnRPcmRlciI6W10sImVsZW1lbnRzIjp7fSwiYmFja2dyb3VuZCI6eyJ0eXBlIjoic29saWQiLCJjb2xvciI6IiNmZmZmZmYifSwibGF5b3V0SWQiOiJsYXlvdXQtdGl0bGUtYm9keSJ9fSwiYWN0aXZlU2xpZGVJZCI6InNsaWRlLTEiLCJ0aGVtZSI6eyJpZCI6InRoZW1lLWRlZmF1bHQiLCJuYW1lIjoiT2ZmaWNlIFRoZW1lIiwiY29sb3JTY2hlbWUiOnsiaWQiOiJjb2xvci1zY2hlbWUtZGVmYXVsdCIsIm5hbWUiOiJPZmZpY2UiLCJkayIxIjoiIzAwMDAwMCIsImx0MSI6IiNmZmZmZmYiLCJkazIiOiIjNDQ1NDZhIiwibHQyIjoiI2U3ZTZlNiIsImFjY2VudDEiOiIjNDQ3MmM0IiwiYWNjZW50MiI6IiNlZDJmMTciLCJhY2NlbnQzIjoiI2ZmYzA1YSIsImFjY2VudDQiOiIjNGY4MWJkIiwiYWNjZW50NSI6IiMzOGJjYTUiLCJhY2NlbnQ2IjoiIzljNWZjNCIsImhsaW5rIjoiIzA1NjNjMSIsImZvbGhsaW5rIjoiIzk1NGZjYyJ9LCJmb250U2NoZW1lIjp7ImlkIjoiZm9udC1zY2hlbWUtZGVmYXVsdCIsIm5hbWUiOiJPZmZpY2UiLCJtYWpvckZvbnQiOiJBcmlhbCIsIm1pbm9yRm9udCI6IkFyaWFsIn0sImZvcm1hdFNjaGVtZSI6eyJpZCI6ImZvcm1hdC1zY2hlbWUtZGVmYXVsdCIsIm5hbWUiOiJPZmZpY2UiLCJmaWxsU3R5bGVMc3QiOlt7ImZpbGxUeXBlIjoyLCJjb2xvciI6IiM0NDcyYzQiLCJvcGFjaXR5IjoxfSx7ImZpbGxUeXBlIjoyLCJjb2xvciI6IiM0NDcyYzQiLCJvcGFjaXR5IjowLjJ9LHsiZmlsbFR5cGUiOjIsImNvbG9yIjoiIzQ0NzJjNCIsIm9wYWNpdHkiOjF9LHsiZmlsbFR5cGUiOjMsImdyYWRpZW50QW5nbGUiOjkwLCJncmFkaWVudFN0b3BzIjpbeyJwb3NpdGlvbiI6MCwiY29sb3IiOiIjNWI5YmQ1In0seyJwb3NpdGlvbiI6MSwiY29sb3IiOiIjNDQ3MmM0In1dfV0sImxuU3R5bGVMc3QiOlt7ImxpbmVTdHJva2VUeXBlIjoyLCJjb2xvciI6IiM0NDcyYzQiLCJ3aWR0aCI6MSwib3BhY2l0eSI6MX0seyJsaW5lU3Ryb2tlVHlwZSI6MiwiY29sb3IiOiIjNDQ1NDZhIiwid2lkdGgiOjEuNSwib3BhY2l0eSI6MX0seyJsaW5lU3Ryb2tlVHlwZSI6MiwiY29sb3IiOiIjMDAwMDAwIiwid2lkdGgiOjIuMjUsIm9wYWNpdHkiOjF9XSwiZWZmZWN0U3R5bGVMc3QiOlt7fSx7Im91dGVyU2hhZG93Ijp7ImNvbG9yIjoicmdiYSgwLCAwLCAwLCAwLjE4KSIsImJsdXJSYWRpdXMiOjQsImRpcmVjdGlvbiI6NDUsImRpc3RhbmNlIjoyLCJyb3RhdGVXaXRoU2hhcGUiOmZhbHNlfX0seyJvdXRlclNoYWRvdyI6eyJjb2xvciI6InJnYmEoMCwgMCwgMCwgMC4yOCkiLCJibHVyUmFkaXVzIjo4LCJkaXJlY3Rpb24iOjQ1LCJkaXN0YW5jZSI6NCwicm90YXRlV2l0aFNoYXBlIjpmYWxzZX19XSwiYmdGaWxsU3R5bGVMc3QiOlt7ImZpbGxUeXBlIjoyLCJjb2xvciI6IiNmZmZmZmYiLCJvcGFjaXR5IjoxfSx7ImZpbGxUeXBlIjoyLCJjb2xvciI6IiNlN2U2ZTYiLCJvcGFjaXR5IjoxfSx7ImZpbGxUeXBlIjozLCJncmFkaWVudEFuZ2xlIjo5MCwiZ3JhZGllbnRTdG9wcyI6W3sicG9zaXRpb24iOjAsImNvbG9yIjoiI2ZmZmZmZiJ9LHsicG9zaXRpb24iOjEsImNvbG9yIjoiI2U3ZTZlNiJ9XX1dfX0sIm1hc3RlclBhZ2VPcmRlciI6WyJtYXN0ZXItZGVmYXVsdCJdLCJtYXN0ZXJQYWdlcyI6eyJtYXN0ZXItZGVmYXVsdCI6eyJpZCI6Im1hc3Rlci1kZWZhdWx0IiwicGFnZVR5cGUiOiJtYXN0ZXIiLCJuYW1lIjoiT2ZmaWNlIFRoZW1lIiwicGFnZVNpemUiOnsid2lkdGgiOjk2MCwiaGVpZ2h0Ijo1NDB9LCJlbGVtZW50T3JkZXIiOltdLCJlbGVtZW50cyI6e30sImJhY2tncm91bmQiOnsidHlwZSI6InNvbGlkIiwiY29sb3IiOiIjZmZmZmZmIn19fSwibGF5b3V0UGFnZU9yZGVyIjpbImxheW91dC10aXRsZSIsImxheW91dC10aXRsZS1ib2R5IiwibGF5b3V0LXNlY3Rpb24taGVhZGVyIiwibGF5b3V0LXR3by1jb2x1bW5zIiwibGF5b3V0LWNvbXBhcmlzb24iLCJsYXlvdXQtYmxhbmsiLCJsYXlvdXQtdGl0bGUtb25seSIsImxheW91dC1waWN0dXJlLWNhcHRpb24iXSwibGF5b3V0UGFnZXMiOnsibGF5b3V0LXRpdGxlIjp7ImlkIjoibGF5b3V0LXRpdGxlIiwicGFnZVR5cGUiOiJsYXlvdXQiLCJsYXlvdXRUeXBlIjoidGl0bGUiLCJuYW1lIjoiVGl0bGUgU2xpZGUiLCJtYXN0ZXJQYWdlSWQiOiJtYXN0ZXItZGVmYXVsdCIsInBhZ2VTaXplIjp7IndpZHRoIjo5NjAsImhlaWdodCI6NTQwfSwiZWxlbWVudE9yZGVyIjpbInBoLWNlbnRlci10aXRsZSIsInBoLXN1YnRpdGxlIl0sImVsZW1lbnRzIjp7InBoLWNlbnRlci10aXRsZSI6eyJpZCI6InBoLWNlbnRlci10aXRsZSIsInR5cGUiOiJwbGFjZWhvbGRlciIsInRyYW5zZm9ybSI6eyJsZWZ0Ijo0OCwidG9wIjoxNTEuMjAwMDAwMDAwMDAwMDIsIndpZHRoIjo4NjQsImhlaWdodCI6MTAwfSwicGxhY2Vob2xkZXIiOnsiaWQiOiJwaC1jZW50ZXItdGl0bGUiLCJ0eXBlIjoiY2VudGVyVGl0bGUifX0sInBoLXN1YnRpdGxlIjp7ImlkIjoicGgtc3VidGl0bGUiLCJ0eXBlIjoicGxhY2Vob2xkZXIiLCJ0cmFuc2Zvcm0iOnsibGVmdCI6NDgsInRvcCI6MjY3LjIwMDAwMDAwMDAwMDA1LCJ3aWR0aCI6ODY0LCJoZWlnaHQiOjU2fSwicGxhY2Vob2xkZXIiOnsiaWQiOiJwaC1zdWJ0aXRsZSIsInR5cGUiOiJzdWJ0aXRsZSJ9fX19LCJsYXlvdXQtdGl0bGUtYm9keSI6eyJpZCI6ImxheW91dC10aXRsZS1ib2R5IiwicGFnZVR5cGUiOiJsYXlvdXQiLCJsYXlvdXRUeXBlIjoidGl0bGVBbmRCb2R5IiwibmFtZSI6IlRpdGxlIGFuZCBDb250ZW50IiwibWFzdGVyUGFnZUlkIjoibWFzdGVyLWRlZmF1bHQiLCJwYWdlU2l6ZSI6eyJ3aWR0aCI6OTYwLCJoZWlnaHQiOjU0MH0sImVsZW1lbnRPcmRlciI6WyJwaC10aXRsZSIsInBoLWJvZHkiXSwiZWxlbWVudHMiOnsicGgtdGl0bGUiOnsiaWQiOiJwaC10aXRsZSIsInR5cGUiOiJwbGFjZWhvbGRlciIsInRyYW5zZm9ybSI6eyJsZWZ0Ijo0OCwidG9wIjozMiwid2lkdGgiOjg2NCwiaGVpZ2h0Ijo3Nn0sInBsYWNlaG9sZGVyIjp7ImlkIjoicGgtdGl0bGUiLCJ0eXBlIjoidGl0bGUifX0sInBoLWJvZHkiOnsiaWQiOiJwaC1ib2R5IiwidHlwZSI6InBsYWNlaG9sZGVyIiwidHJhbnNmb3JtIjp7ImxlZnQiOjQ4LCJ0b3AiOjEyOCwid2lkdGgiOjg2NCwiaGVpZ2h0IjozODB9LCJwbGFjZWhvbGRlciI6eyJpZCI6InBoLWJvZHkiLCJ0eXBlIjoiYm9keSJ9fX19LCJsYXlvdXQtc2VjdGlvbi1oZWFkZXIiOnsiaWQiOiJsYXlvdXQtc2VjdGlvbi1oZWFkZXIiLCJwYWdlVHlwZSI6ImxheW91dCIsImxheW91dFR5cGUiOiJzZWN0aW9uSGVhZGVyIiwibmFtZSI6IlNlY3Rpb24gSGVhZGVyIiwibWFzdGVyUGFnZUlkIjoibWFzdGVyLWRlZmF1bHQiLCJwYWdlU2l6ZSI6eyJ3aWR0aCI6OTYwLCJoZWlnaHQiOjU0MH0sImVsZW1lbnRPcmRlciI6WyJwaC1jZW50ZXItdGl0bGUiLCJwaC10ZXh0Il0sImVsZW1lbnRzIjp7InBoLWNlbnRlci10aXRsZSI6eyJpZCI6InBoLWNlbnRlci10aXRsZSIsInR5cGUiOiJwbGFjZWhvbGRlciIsInRyYW5zZm9ybSI6eyJsZWZ0Ijo0OCwidG9wIjoxMzUsIndpZHRoIjo4NjQsImhlaWdodCI6MTAwfSwicGxhY2Vob2xkZXIiOnsiaWQiOiJwaC1jZW50ZXItdGl0bGUiLCJ0eXBlIjoiY2VudGVyVGl0bGUifX0sInBoLXRleHQiOnsiaWQiOiJwaC10ZXh0IiwidHlwZSI6InBsYWNlaG9sZGVyIiwidHJhbnNmb3JtIjp7ImxlZnQiOjQ4LCJ0b3AiOjI1MSwid2lkdGgiOjg2NCwiaGVpZ2h0Ijo1Nn0sInBsYWNlaG9sZGVyIjp7ImlkIjoicGgtdGV4dCIsInR5cGUiOiJ0ZXh0In19fX0sImxheW91dC10d28tY29sdW1ucyI6eyJpZCI6ImxheW91dC10d28tY29sdW1ucyIsInBhZ2VUeXBlIjoibGF5b3V0IiwibGF5b3V0VHlwZSI6InR3b0NvbHVtbnMiLCJuYW1lIjoiVHdvIENvbnRlbnQiLCJtYXN0ZXJQYWdlSWQiOiJtYXN0ZXItZGVmYXVsdCIsInBhZ2VTaXplIjp7IndpZHRoIjo5NjAsImhlaWdodCI6NTQwfSwiZWxlbWVudE9yZGVyIjpbInBoLXRpdGxlIiwicGgtYm9keS1sZWZ0IiwicGgtYm9keS1yaWdodCJdLCJlbGVtZW50cyI6eyJwaC10aXRsZSI6eyJpZCI6InBoLXRpdGxlIiwidHlwZSI6InBsYWNlaG9sZGVyIiwidHJhbnNmb3JtIjp7ImxlZnQiOjQ4LCJ0b3AiOjMyLCJ3aWR0aCI6ODY0LCJoZWlnaHQiOjc2fSwicGxhY2Vob2xkZXIiOnsiaWQiOiJwaC10aXRsZSIsInR5cGUiOiJ0aXRsZSJ9fSwicGgtYm9keS1sZWZ0Ijp7ImlkIjoicGgtYm9keS1sZWZ0IiwidHlwZSI6InBsYWNlaG9sZGVyIiwidHJhbnNmb3JtIjp7ImxlZnQiOjQ4LCJ0b3AiOjEyOCwid2lkdGgiOjQyMiwiaGVpZ2h0IjozODB9LCJwbGFjZWhvbGRlciI6eyJpZCI6InBoLWJvZHktbGVmdCIsInR5cGUiOiJib2R5IiwiaW5kZXgiOjF9fSwicGgtYm9keS1yaWdodCI6eyJpZCI6InBoLWJvZHktcmlnaHQiLCJ0eXBlIjoicGxhY2Vob2xkZXIiLCJ0cmFuc2Zvcm0iOnsibGVmdCI6NDkwLCJ0b3AiOjEyOCwid2lkdGgiOjQyMiwiaGVpZ2h0IjozODB9LCJwbGFjZWhvbGRlciI6eyJpZCI6InBoLWJvZHktcmlnaHQiLCJ0eXBlIjoiYm9keSIsImluZGV4IjoyfX19fSwibGF5b3V0LWNvbXBhcmlzb24iOnsiaWQiOiJsYXlvdXQtY29tcGFyaXNvbiIsInBhZ2VUeXBlIjoibGF5b3V0IiwibGF5b3V0VHlwZSI6ImNvbXBhcmlzb24iLCJuYW1lIjoiQ29tcGFyaXNvbiIsIm1hc3RlclBhZ2VJZCI6Im1hc3Rlci1kZWZhdWx0IiwicGFnZVNpemUiOnsid2lkdGgiOjk2MCwiaGVpZ2h0Ijo1NDB9LCJlbGVtZW50T3JkZXIiOlsicGgtdGl0bGUiLCJwaC10ZXh0LWxlZnQiLCJwaC10ZXh0LXJpZ2h0IiwicGgtYm9keS1sZWZ0IiwicGgtYm9keS1yaWdodCJdLCJlbGVtZW50cyI6eyJwaC10aXRsZSI6eyJpZCI6InBoLXRpdGxlIiwidHlwZSI6InBsYWNlaG9sZGVyIiwidHJhbnNmb3JtIjp7ImxlZnQiOjQ4LCJ0b3AiOjMyLCJ3aWR0aCI6ODY0LCJoZWlnaHQiOjc2fSwicGxhY2Vob2xkZXIiOnsiaWQiOiJwaC10aXRsZSIsInR5cGUiOiJ0aXRsZSJ9fSwicGgtdGV4dC1sZWZ0Ijp7ImlkIjoicGgtdGV4dC1sZWZ0IiwidHlwZSI6InBsYWNlaG9sZGVyIiwidHJhbnNmb3JtIjp7ImxlZnQiOjQ4LCJ0b3AiOjEyOCwid2lkdGgiOjQyMiwiaGVpZ2h0Ijo0MH0sInBsYWNlaG9sZGVyIjp7ImlkIjoicGgtdGV4dC1sZWZ0IiwidHlwZSI6InRleHQiLCJpbmRleCI6MX19LCJwaC10ZXh0LXJpZ2h0Ijp7ImlkIjoicGgtdGV4dC1yaWdodCIsInR5cGUiOiJwbGFjZWhvbGRlciIsInRyYW5zZm9ybSI6eyJsZWZ0Ijo0OTAsInRvcCI6MTI4LCJ3aWR0aCI6NDIyLCJoZWlnaHQiOjQwfSwicGxhY2Vob2xkZXIiOnsiaWQiOiJwaC10ZXh0LXJpZ2h0IiwidHlwZSI6InRleHQiLCJpbmRleCI6Mn19LCJwaC1ib2R5LWxlZnQiOnsiaWQiOiJwaC1ib2R5LWxlZnQiLCJ0eXBlIjoicGxhY2Vob2xkZXIiLCJ0cmFuc2Zvcm0iOnsibGVmdCI6NDgsInRvcCI6MTc2LCJ3aWR0aCI6NDIyLCJoZWlnaHQiOjMzMn0sInBsYWNlaG9sZGVyIjp7ImlkIjoicGgtYm9keS1sZWZ0IiwidHlwZSI6ImJvZHkiLCJpbmRleCI6MX19LCJwaC1ib2R5LXJpZ2h0Ijp7ImlkIjoicGgtYm9keS1yaWdodCIsInR5cGUiOiJwbGFjZWhvbGRlciIsInRyYW5zZm9ybSI6eyJsZWZ0Ijo0OTAsInRvcCI6MTc2LCJ3aWR0aCI6NDIyLCJoZWlnaHQiOjMzMn0sInBsYWNlaG9sZGVyIjp7ImlkIjoicGgtYm9keS1yaWdodCIsInR5cGUiOiJib2R5IiwiaW5kZXgiOjJ9fX19LCJsYXlvdXQtYmxhbmsiOnsiaWQiOiJsYXlvdXQtYmxhbmsiLCJwYWdlVHlwZSI6ImxheW91dCIsImxheW91dFR5cGUiOiJibGFuayIsIm5hbWUiOiJCbGFuayIsIm1hc3RlclBhZ2VJZCI6Im1hc3Rlci1kZWZhdWx0IiwicGFnZVNpemUiOnsid2lkdGgiOjk2MCwiaGVpZ2h0Ijo1NDB9LCJlbGVtZW50T3JkZXIiOltdLCJlbGVtZW50cyI6e319LCJsYXlvdXQtdGl0bGUtb25seSI6eyJpZCI6ImxheW91dC10aXRsZS1vbmx5IiwicGFnZVR5cGUiOiJsYXlvdXQiLCJsYXlvdXRUeXBlIjoidGl0bGVPbmx5IiwibmFtZSI6IlRpdGxlIE9ubHkiLCJtYXN0ZXJQYWdlSWQiOiJtYXN0ZXItZGVmYXVsdCIsInBhZ2VTaXplIjp7IndpZHRoIjo5NjAsImhlaWdodCI6NTQwfSwiZWxlbWVudE9yZGVyIjpbInBoLXRpdGxlIl0sImVsZW1lbnRzIjp7InBoLXRpdGxlIjp7ImlkIjoicGgtdGl0bGUiLCJ0eXBlIjoicGxhY2Vob2xkZXIiLCJ0cmFuc2Zvcm0iOnsibGVmdCI6NDgsInRvcCI6MzIsIndpZHRoIjo4NjQsImhlaWdodCI6NzZ9LCJwbGFjZWhvbGRlciI6eyJpZCI6InBoLXRpdGxlIiwidHlwZSI6InRpdGxlIn19fX0sImxheW91dC1waWN0dXJlLWNhcHRpb24iOnsiaWQiOiJsYXlvdXQtcGljdHVyZS1jYXB0aW9uIiwicGFnZVR5cGUiOiJsYXlvdXQiLCJsYXlvdXRUeXBlIjoicGljdHVyZVdpdGhDYXB0aW9uIiwibmFtZSI6IlBpY3R1cmUgd2l0aCBDYXB0aW9uIiwibWFzdGVyUGFnZUlkIjoibWFzdGVyLWRlZmF1bHQiLCJwYWdlU2l6ZSI6eyJ3aWR0aCI6OTYwLCJoZWlnaHQiOjU0MH0sImVsZW1lbnRPcmRlciI6WyJwaC1waWN0dXJlIiwicGgtY2FwdGlvbiJdLCJlbGVtZW50cyI6eyJwaC1waWN0dXJlIjp7ImlkIjoicGgtcGljdHVyZSIsInR5cGUiOiJwbGFjZWhvbGRlciIsInRyYW5zZm9ybSI6eyJsZWZ0Ijo0OCwidG9wIjozMiwid2lkdGgiOjg2NCwiaGVpZ2h0IjozODh9LCJwbGFjZWhvbGRlciI6eyJpZCI6InBoLXBpY3R1cmUiLCJ0eXBlIjoicGljdHVyZSJ9fSwicGgtY2FwdGlvbiI6eyJpZCI6InBoLWNhcHRpb24iLCJ0eXBlIjoicGxhY2Vob2xkZXIiLCJ0cmFuc2Zvcm0iOnsibGVmdCI6NDgsInRvcCI6NDM2LCJ3aWR0aCI6ODY0LCJoZWlnaHQiOjU2fSwicGxhY2Vob2xkZXIiOnsiaWQiOiJwaC1jYXB0aW9uIiwidHlwZSI6InRleHQifX19fX0=";

export function generateDefaultSnapshot(unitId: string, type: number | string, name?: string) {
  const numType = typeof type === "string" ? (type === "doc" ? 1 : type === "slide" ? 3 : 2) : type;
  const docName = name || (numType === 1 ? "Untitled Document" : numType === 3 ? "Untitled Presentation" : "Untitled Spreadsheet");

  if (numType === 1) {
    return {
      unitID: unitId,
      rev: 1,
      type: 1,
      doc: {
        unitID: unitId,
        rev: 1,
        creator: "",
        name: docName,
        resources: [],
        originalMeta: DEFAULT_DOC_ORIGINAL_META
      }
    };
  }

  if (numType === 3) {
    return {
      unitID: unitId,
      rev: 1,
      type: 3,
      slide: {
        unitID: unitId,
        rev: 1,
        creator: "",
        name: docName,
        resources: [],
        originalMeta: DEFAULT_SLIDE_ORIGINAL_META
      }
    };
  }

  // Default: Sheet (type 2)
  return {
    unitID: unitId,
    rev: 1,
    type: 2,
    workbook: {
      unitID: unitId,
      rev: 1,
      creator: "",
      name: docName,
      sheetOrder: ["sheet_1"],
      sheets: {
        sheet_1: {
          id: "sheet_1",
          type: 0,
          name: "Sheet 1",
          rowCount: 1000,
          columnCount: 20,
          originalMeta: DEFAULT_SHEET_ORIGINAL_META
        }
      },
      blockMeta: {
        sheet_1: {
          sheetID: "sheet_1",
          blocks: []
        }
      },
      resources: [],
      originalMeta: DEFAULT_WORKBOOK_ORIGINAL_META
    }
  };
}
