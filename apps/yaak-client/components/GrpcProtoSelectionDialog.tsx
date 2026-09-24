import type { GrpcRequest } from "@yaakapp-internal/models";
import { Banner, InlineCode, VStack } from "@yaakapp-internal/ui";
import { useActiveRequest } from "../hooks/useActiveRequest";
import { useGrpc } from "../hooks/useGrpc";
import { useGrpcProtoFiles } from "../hooks/useGrpcProtoFiles";
import { pluralizeCount } from "../lib/pluralize";
import { DialogFooter } from "./core/Dialog";
import { PathList } from "./core/PathList";
import { Link } from "./core/Link";
import { platform } from "@yaakapp-internal/platform";

interface Props {
  onDone: () => void;
}

export function GrpcProtoSelectionDialog(props: Props) {
  const request = useActiveRequest();
  if (request?.model !== "grpc_request") return null;

  return <GrpcProtoSelectionDialogWithRequest request={request} {...props} />;
}

function GrpcProtoSelectionDialogWithRequest({
  request,
  onDone,
}: Props & { request: GrpcRequest }) {
  const protoFilesKv = useGrpcProtoFiles(request.id);
  const protoFiles = protoFilesKv.value ?? [];
  const grpc = useGrpc(request, null, protoFiles);
  const services = grpc.reflect.data;
  const serverReflection = protoFiles.length === 0 && services != null;
  let reflectError = grpc.reflect.error ?? null;
  const reflectionUnimplemented = String(reflectError).match(/unimplemented/i);

  if (reflectionUnimplemented) {
    reflectError = null;
  }

  if (request == null) {
    return null;
  }

  return (
    <>
      <DialogFooter
        actions={[
          {
            label: "Refresh Schema",
            isLoading: grpc.reflect.isFetching,
            disabled: grpc.reflect.isFetching,
            onClick: () => grpc.reflect.refetch(),
          },
          { label: "Done", color: "primary", onClick: onDone },
        ]}
      />
      <VStack space={5} className="pb-4">
        {reflectError && (
          <Banner color="warning">
            <h1 className="font-bold">
              Reflection failed on URL <InlineCode>{request.url || "n/a"}</InlineCode>
            </h1>
            <p>{reflectError.trim()}</p>
          </Banner>
        )}
        {!serverReflection && services != null && services.length > 0 && (
          <Banner className="flex flex-col gap-2">
            <p>
              Found services{" "}
              {services?.slice(0, 5).map((s, i) => {
                return (
                  <span key={s.name + s.methods.map((m) => m.name).join(",")}>
                    <InlineCode>{s.name}</InlineCode>
                    {i === services.length - 1 ? "" : i === services.length - 2 ? " and " : ", "}
                  </span>
                );
              })}
              {services?.length > 5 && pluralizeCount("other", services?.length - 5)}
            </p>
          </Banner>
        )}
        {serverReflection && services != null && services.length > 0 && (
          <Banner className="flex flex-col gap-2">
            <p>
              Server reflection found services
              {services?.map((s, i) => {
                return (
                  <span key={s.name + s.methods.map((m) => m.name).join(",")}>
                    <InlineCode>{s.name}</InlineCode>
                    {i === services.length - 1 ? "" : i === services.length - 2 ? " and " : ", "}
                  </span>
                );
              })}
              . You can override this schema by manually selecting <InlineCode>*.proto</InlineCode>{" "}
              files.
            </p>
          </Banner>
        )}

        <PathList
          items={protoFiles.map((path) => ({
            path,
            icon: path.endsWith(".proto") ? "file_code" : "folder_code",
          }))}
          onRemove={async (path) => {
            await protoFilesKv.set(protoFiles.filter((p) => p !== path));
            await grpc.reflect.refetch();
          }}
          addLabel="Add proto files or an import folder"
          addItems={[
            {
              label: "Proto files",
              icon: "file_code",
              onSelect: async () => {
                const selected = await platform.dialog.open({
                  title: "Select Proto Files",
                  multiple: true,
                  filters: [{ name: "Proto Files", extensions: ["proto"] }],
                });
                if (selected == null) return;
                const newFiles = selected.filter((p) => !protoFiles.includes(p));
                await protoFilesKv.set([...protoFiles, ...newFiles]);
                await grpc.reflect.refetch();
              },
            },
            {
              label: "Import folder",
              icon: "folder_code",
              onSelect: async () => {
                const selected = await platform.dialog.open({
                  title: "Select Proto Directory",
                  directory: true,
                });
                if (selected == null) return;
                await protoFilesKv.set([...protoFiles.filter((f) => f !== selected), selected]);
                await grpc.reflect.refetch();
              },
            },
          ]}
        />
        {reflectionUnimplemented && protoFiles.length === 0 && (
          <Banner>
            <InlineCode>{request.url}</InlineCode> doesn&apos;t implement{" "}
            <Link href="https://github.com/grpc/grpc/blob/9aa3c5835a4ed6afae9455b63ed45c761d695bca/doc/server-reflection.md">
              Server Reflection
            </Link>{" "}
            . Please manually add the <InlineCode>.proto</InlineCode> file to get started.
          </Banner>
        )}
      </VStack>
    </>
  );
}
