import { open } from "@tauri-apps/plugin-dialog";
import type { GrpcRequest } from "@yaakapp-internal/models";
import { useActiveRequest } from "../hooks/useActiveRequest";
import { useGrpc } from "../hooks/useGrpc";
import { useGrpcProtoFiles } from "../hooks/useGrpcProtoFiles";
import { pluralizeCount } from "../lib/pluralize";
import { Banner } from "./core/Banner";
import { Button } from "./core/Button";
import { Icon } from "./core/Icon";
import { IconButton } from "./core/IconButton";
import { InlineCode } from "./core/InlineCode";
import { Link } from "./core/Link";
import { HStack, VStack } from "./core/Stacks";

interface Props {
  onDone: () => void;
}

export function GrpcProtoSelectionDialog(props: Props) {
  const request = useActiveRequest();
  if (request?.model !== "grpc_request") return null;

  return <GrpcProtoSelectionDialogWithRequest request={request} {...props} />;
}

function GrpcProtoSelectionDialogWithRequest({ request }: Props & { request: GrpcRequest }) {
  const protoFilesKv = useGrpcProtoFiles(request.id);
  const protoFiles = protoFilesKv.value ?? [];
  const grpc = useGrpc(request, null, protoFiles);
  const services = grpc.reflect.data;
  const serverReflection = protoFiles.length === 0 && services != null;
  let reflectError = grpc.reflect.error ?? null;
  const reflectionUnimplemented = `${reflectError}`.match(/unimplemented/i);

  if (reflectionUnimplemented) {
    reflectError = null;
  }

  if (request == null) {
    return null;
  }

  return (
    <VStack className="flex-col-reverse mb-3" space={3}>
      {/* Buttons on top so they get focus first */}
      <HStack space={2} justifyContent="start" className="flex-row-reverse mt-3">
        <Button
          color="primary"
          variant="border"
          onClick={async () => {
            const selected = await open({
              title: "Выберите файлы Proto",
              multiple: true,
              filters: [{ name: "Файлы Proto", extensions: ["proto"] }],
            });
            if (selected == null) return;

            const newFiles = selected.filter((p) => !protoFiles.includes(p));
            await protoFilesKv.set([...protoFiles, ...newFiles]);
            await grpc.reflect.refetch();
          }}
        >
          Добавить файлы Proto
        </Button>
        <Button
          variant="border"
          color="primary"
          onClick={async () => {
            const selected = await open({
              title: "Выберите каталог Proto",
              directory: true,
            });
            if (selected == null) return;

            await protoFilesKv.set([...protoFiles.filter((f) => f !== selected), selected]);
            await grpc.reflect.refetch();
          }}
        >
          Добавить папки импорта
        </Button>
        <Button
          isLoading={grpc.reflect.isFetching}
          disabled={grpc.reflect.isFetching}
          variant="border"
          color="secondary"
          onClick={() => grpc.reflect.refetch()}
        >
          Обновить схему
        </Button>
      </HStack>
      <VStack space={5}>
        {reflectError && (
          <Banner color="warning">
            <h1 className="font-bold">
              Ошибка рефлексии по URL <InlineCode>{request.url || "n/a"}</InlineCode>
            </h1>
            <p>{reflectError.trim()}</p>
          </Banner>
        )}
        {!serverReflection && services != null && services.length > 0 && (
          <Banner className="flex flex-col gap-2">
            <p>
              Найдены сервисы{" "}
              {services?.slice(0, 5).map((s, i) => {
                return (
                  <span key={s.name + s.methods.map((m) => m.name).join(",")}>
                    <InlineCode>{s.name}</InlineCode>
                    {i === services.length - 1 ? "" : i === services.length - 2 ? " и " : ", "}
                  </span>
                );
              })}
              {services?.length > 5 && pluralizeCount("других", services?.length - 5)}
            </p>
          </Banner>
        )}
        {serverReflection && services != null && services.length > 0 && (
          <Banner className="flex flex-col gap-2">
            <p>
              Рефлексия сервера нашла сервисы
              {services?.map((s, i) => {
                return (
                  <span key={s.name + s.methods.map((m) => m.name).join(",")}>
                    <InlineCode>{s.name}</InlineCode>
                    {i === services.length - 1 ? "" : i === services.length - 2 ? " и " : ", "}
                  </span>
                );
              })}
              . Вы можете переопределить эту схему, вручную выбрав файлы <InlineCode>*.proto</InlineCode>.
            </p>
          </Banner>
        )}

        {protoFiles.length > 0 && (
          <table className="w-full divide-y divide-surface-highlight">
            <thead>
              <tr>
                <th className="text-text-subtlest" colSpan={3}>
                  Добавленные пути файлов
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-highlight">
              {protoFiles.map((f, i) => {
                const parts = f.split("/");
                return (
                  // oxlint-disable-next-line react/no-array-index-key
                  <tr key={f + i} className="group">
                    <td>
                      <Icon icon={f.endsWith(".proto") ? "file_code" : "folder_code"} />
                    </td>
                    <td className="pl-1 font-mono text-sm" title={f}>
                      {parts.length > 3 && ".../"}
                      {parts.slice(-3).join("/")}
                    </td>
                    <td className="w-0 py-0.5">
                      <IconButton
                        title="Удалить файл"
                        variant="border"
                        size="xs"
                        icon="trash"
                        className="my-0.5 ml-auto opacity-50 transition-opacity group-hover:opacity-100"
                        onClick={async () => {
                          await protoFilesKv.set(protoFiles.filter((p) => p !== f));
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {reflectionUnimplemented && protoFiles.length === 0 && (
          <Banner>
            <InlineCode>{request.url}</InlineCode> не поддерживает{" "}
            <Link href="https://github.com/grpc/grpc/blob/9aa3c5835a4ed6afae9455b63ed45c761d695bca/doc/server-reflection.md">
              Server Reflection
            </Link>{" "}
            . Чтобы начать, добавьте вручную файл <InlineCode>.proto</InlineCode>.
          </Banner>
        )}
      </VStack>
    </VStack>
  );
}
