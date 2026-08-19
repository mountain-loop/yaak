import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vite-plus/test";
import { CsvViewerInner } from "./CsvViewer";

vi.mock("@yaakapp-internal/ui", () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children }: { children: ReactNode }) => <td>{children}</td>,
  TableHead: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableHeaderCell: ({ children }: { children: ReactNode }) => <th>{children}</th>,
  TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
}));

describe("CsvViewer", () => {
  test("renders columns that extend beyond the first row", () => {
    const markup = renderToStaticMarkup(
      <CsvViewerInner
        text={[
          "startDate,2026-02-03T00:00-03:00",
          "endDate,2026-02-03T23:59:59-03:00",
          "id,Fecha de inicio,Nombre,Estado,Perfil de puesto,ID de sucursal,Sucursal,Fecha de fin,ID de usuario",
          "391118210,2026-02-03 12:58:55,atencion1,Disponible,ATD,3549,sucursal,2026-02-03 12:59:08,42041",
        ].join("\n")}
      />,
    );

    expect(markup).toContain("ID de usuario");
    expect(markup).toContain("42041");
    expect(markup.match(/<td>/g)).toHaveLength(20);
  });
});
