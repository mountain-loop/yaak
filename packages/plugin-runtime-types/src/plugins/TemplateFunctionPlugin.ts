import {
  CallTemplateFunctionArgs,
  TemplateFunction,
} from "../bindings/events";
import { Context } from "./Context";

export type TemplateFunctionPlugin = TemplateFunction & {
  onRender(
    ctx: Context,
    args: CallTemplateFunctionArgs,
  ): Promise<string | null>;
};
