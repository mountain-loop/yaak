import type { CallTemplateFunctionArgs, Context, PluginDefinition } from "@yaakapp/api";

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: "cookie.value",
      description: "Read the value of a cookie in the jar, by name",
      previewArgs: ["name"],
      args: [
        {
          type: "text",
          name: "name",
          label: "Cookie Name",
          placeholder: "cookie_name",
        },
        {
          type: "text",
          name: "domain",
          label: "Domain",
          placeholder: "example.com",
          description:
            "Optionally filter by domain, useful if multiple cookies with the same name.",
          optional: true,
        },
      ],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        // The legacy name was cookie_name, but we changed it
        const name = args.values.cookie_name ?? args.values.name;
        const domain = String(args.values.domain ?? "").trim();

        return ctx.cookies.getValue({
          name: String(name),
          ...(domain.length > 0 ? { domain } : {}),
        });
      },
    },
  ],
};
