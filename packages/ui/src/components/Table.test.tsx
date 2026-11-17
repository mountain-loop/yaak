import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "./Table";
import { CsvViewerInner } from "./viewers/CsvViewer";

function table(density?: "default" | "compact") {
  return renderToStaticMarkup(
    <Table density={density}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Name</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow>
          <TableCell>Accept</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

describe("Table density", () => {
  test("a compact table trims its cells' and header's padding", () => {
    const markup = table("compact");
    expect(markup).toContain('data-density="compact"');
    expect(markup).toContain("[&amp;_td]:py-0.5");
    expect(markup).toContain("[&amp;_th]:py-0.5");
  });

  test("other tables keep their spacing", () => {
    const markup = table();
    expect(markup).toContain('data-density="default"');
    expect(markup).not.toContain("py-0.5");
    expect(markup).toContain("py-2");
  });

  test("the CSV viewer's table is compact", () => {
    expect(renderToStaticMarkup(<CsvViewerInner text={"a,b\n1,2"} />)).toContain(
      'data-density="compact"',
    );
  });
});
