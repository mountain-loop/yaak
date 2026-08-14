import { useQuery } from "@tanstack/react-query";
import classNames from "classnames";
import { platform } from "@yaakapp-internal/platform";

interface Props {
  src: string;
  className?: string;
}

export function LocalImage({ src: srcPath, className }: Props) {
  const src = useQuery({
    queryKey: ["local-image", srcPath],
    queryFn: async () => {
      const p = await platform.files.resolveResource(srcPath);
      return platform.files.url(p);
    },
  });

  return (
    <img
      src={src.data}
      alt="Response preview"
      className={classNames(
        className,
        "transition-opacity",
        src.data == null ? "opacity-0" : "opacity-100",
      )}
    />
  );
}
