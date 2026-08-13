import { describe, expect, test } from "vite-plus/test";
import {
  derivePathPlaceholderPairs,
  extractPathPlaceholders,
  renamePathPlaceholder,
} from "./pathPlaceholders";

describe("extractPathPlaceholders", () => {
  test("extracts a single placeholder", () => {
    expect(extractPathPlaceholders("/users/:id")).toEqual([":id"]);
  });

  test("extracts multiple placeholders", () => {
    expect(extractPathPlaceholders("/users/:id/posts/:postId")).toEqual([":id", ":postId"]);
  });

  test("stops at a literal `:` in the same segment", () => {
    expect(extractPathPlaceholders("/tasks/:id:cancel")).toEqual([":id"]);
  });

  test("does not match `:foo` mid-segment", () => {
    expect(extractPathPlaceholders("/users/abc:def")).toEqual([]);
  });

  test("does not match `:` in a host port", () => {
    expect(extractPathPlaceholders("https://example.com:8080/users/:id")).toEqual([":id"]);
  });

  test("returns empty for a URL with no placeholders", () => {
    expect(extractPathPlaceholders("https://example.com/foo/bar?q=1#hash")).toEqual([]);
  });
});

describe("derivePathPlaceholderPairs", () => {
  const neverRename = () => false;

  test("adds a row for a placeholder with no parameter", () => {
    const { urlParameterPairs } = derivePathPlaceholderPairs("/users/:id", [], neverRename);
    expect(urlParameterPairs).toMatchObject([{ name: ":id", value: "", enabled: true }]);
    expect(urlParameterPairs[0]?.commitName).toBeTypeOf("function");
  });

  test("gives the existing parameter for a placeholder a commitName, without mutating it", () => {
    const parameter = { name: ":id", value: "123", enabled: true, id: "p1" };
    const { urlParameterPairs } = derivePathPlaceholderPairs(
      "/users/:id",
      [parameter],
      neverRename,
    );
    expect(urlParameterPairs[0]).toMatchObject({ name: ":id", value: "123", id: "p1" });
    expect(urlParameterPairs[0]?.commitName).toBeTypeOf("function");
    expect(parameter).toEqual({ name: ":id", value: "123", enabled: true, id: "p1" });
  });

  test("leaves query parameters alone", () => {
    const { urlParameterPairs } = derivePathPlaceholderPairs(
      "/users/:id",
      [{ name: "q", value: "hi", enabled: true, id: "p1" }],
      neverRename,
    );
    expect(urlParameterPairs[0]).toEqual({ name: "q", value: "hi", enabled: true, id: "p1" });
    expect(urlParameterPairs[1]?.commitName).toBeTypeOf("function");
  });

  test("commitName renames this row's placeholder", () => {
    const renames: [string, string][] = [];
    const { urlParameterPairs } = derivePathPlaceholderPairs(
      "/a/:x/b/:y",
      [],
      (oldName, newName) => {
        renames.push([oldName, newName]);
        return true;
      },
    );
    urlParameterPairs[1]?.commitName?.(":z");
    expect(renames).toEqual([[":y", ":z"]]);
  });

  test("drops empty parameters", () => {
    const { urlParameterPairs } = derivePathPlaceholderPairs(
      "/users",
      [
        { name: "", value: "", enabled: true, id: "p1" },
        { name: "q", value: "", enabled: true, id: "p2" },
      ],
      neverRename,
    );
    expect(urlParameterPairs).toMatchObject([{ name: "q", id: "p2" }]);
  });

  test("collapses a placeholder that appears twice into one row", () => {
    const { urlParameterPairs } = derivePathPlaceholderPairs("/a/:id/b/:id", [], neverRename);
    expect(urlParameterPairs).toMatchObject([{ name: ":id" }]);
  });

  test("gives a derived row the same id every time, so re-deriving is stable", () => {
    const first = derivePathPlaceholderPairs("/users/:id", [], neverRename);
    const second = derivePathPlaceholderPairs("/users/:id", [], neverRename);
    expect(first.urlParameterPairs[0]?.id).toEqual(second.urlParameterPairs[0]?.id);
  });

  test("derived row ids avoid colliding with a persisted derived id", () => {
    // A derived id sticks to the parameter once the user gives the row a value. If its placeholder
    // is then renamed away in the URL bar, the parameter survives as a stray still holding the id,
    // and the replacement placeholder's row must not collide with it.
    const stray = { name: ":old", value: "42", enabled: true, id: "path-placeholder:0" };
    const { urlParameterPairs } = derivePathPlaceholderPairs("/pets/:new", [stray], neverRename);
    const ids = urlParameterPairs.map((p) => p.id);
    expect(new Set(ids).size).toEqual(ids.length);
  });

  test("keeps a derived row's id stable across a rename", () => {
    const before = derivePathPlaceholderPairs("/a/:x/b/:y", [], neverRename);
    const after = derivePathPlaceholderPairs("/a/:x2/b/:y", [], neverRename);
    expect(after.urlParameterPairs.map((p) => p.id)).toEqual(
      before.urlParameterPairs.map((p) => p.id),
    );
  });

  test("keys off the placeholder names", () => {
    expect(derivePathPlaceholderPairs("/a/:x/b/:y", [], neverRename).urlParametersKey).toEqual(
      ":x,:y",
    );
    expect(derivePathPlaceholderPairs("/a/b", [], neverRename).urlParametersKey).toEqual("");
  });
});

describe("renamePathPlaceholder", () => {
  const model = (url: string, urlParameters: { name: string; value: string }[] = []) => ({
    url,
    urlParameters,
  });

  test("renames the placeholder in the URL", () => {
    expect(
      renamePathPlaceholder(model("https://x.com/pets/:petId/info"), ":petId", ":animalId"),
    ).toEqual({ url: "https://x.com/pets/:animalId/info", urlParameters: [] });
  });

  test("carries the parameter value over to the new name", () => {
    const patch = renamePathPlaceholder(
      model("/pets/:petId", [
        { name: "q", value: "1" },
        { name: ":petId", value: "42" },
      ]),
      ":petId",
      ":animalId",
    );
    expect(patch).toEqual({
      url: "/pets/:animalId",
      urlParameters: [
        { name: "q", value: "1" },
        { name: ":animalId", value: "42" },
      ],
    });
  });

  test("renames every occurrence of a repeated placeholder", () => {
    expect(renamePathPlaceholder(model("/a/:id/b/:id"), ":id", ":key")?.url).toEqual(
      "/a/:key/b/:key",
    );
  });

  test("adds a missing leading colon", () => {
    expect(renamePathPlaceholder(model("/pets/:petId"), ":petId", "animalId")?.url).toEqual(
      "/pets/:animalId",
    );
  });

  test("renames a placeholder followed by a literal colon", () => {
    expect(renamePathPlaceholder(model("/tasks/:id:cancel"), ":id", ":taskId")?.url).toEqual(
      "/tasks/:taskId:cancel",
    );
  });

  test("does not rename a placeholder the new name is a prefix of", () => {
    expect(renamePathPlaceholder(model("/a/:id/b/:idx"), ":id", ":key")?.url).toEqual(
      "/a/:key/b/:idx",
    );
  });

  test("does not touch a same-named segment that isn't a placeholder", () => {
    expect(renamePathPlaceholder(model("/id/:id?x=:id"), ":id", ":key")?.url).toEqual(
      "/id/:key?x=:id",
    );
  });

  test("treats regex characters in the old name literally", () => {
    expect(renamePathPlaceholder(model("/a/:i.d/b/:iXd"), ":i.d", ":key")?.url).toEqual(
      "/a/:key/b/:iXd",
    );
  });

  test.each([[""], [":"], [":a/b"], [":a?b"], [":a#b"], [":a:b"], [":a b"], [":a\tb"]])(
    "rejects the unusable name %j",
    (name) => {
      expect(renamePathPlaceholder(model("/pets/:petId"), ":petId", name)).toBeNull();
    },
  );

  test("rejects a name already used by another placeholder", () => {
    expect(renamePathPlaceholder(model("/pets/:petId/:ownerId"), ":petId", ":ownerId")).toBeNull();
  });

  test("allows renaming a placeholder to itself", () => {
    expect(renamePathPlaceholder(model("/pets/:petId"), ":petId", ":petId")?.url).toEqual(
      "/pets/:petId",
    );
  });

  test("rejects renaming a placeholder that isn't in the URL", () => {
    expect(renamePathPlaceholder(model("/pets/:petId"), ":other", ":animalId")).toBeNull();
  });
});
