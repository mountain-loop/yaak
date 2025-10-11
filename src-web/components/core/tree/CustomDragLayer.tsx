import type { CSSProperties, ReactNode } from 'react';
import type { XYCoord } from 'react-dnd';
import { useDragLayer } from 'react-dnd';
import { ItemTypes } from './dnd';

interface Props {
  children: ReactNode;
}

export function CustomDragLayer({ children }: Props) {
  const { isDragging, itemType, initialOffset, currentOffset, clientOffset } = useDragLayer(
    (monitor) => ({
      item: monitor.getItem(),
      itemType: monitor.getItemType(),
      initialOffset: monitor.getInitialSourceClientOffset(),
      currentOffset: monitor.getSourceClientOffset(),
      clientOffset: monitor.getClientOffset(),
      isDragging: monitor.isDragging(),
    }),
  );

  if (itemType !== ItemTypes.TREE && itemType !== ItemTypes.TREE_ITEM) {
    return null;
  }

  if (!isDragging) {
    return null;
  }

  return (
    <div style={layerStyles}>
      <div style={getItemStyles(initialOffset, currentOffset, clientOffset)}>{children}</div>
    </div>
  );
}
const layerStyles: CSSProperties = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: 1000,
  left: 0,
  top: 0,
  width: '100%',
  height: '100%',
};

function getItemStyles(
  initialOffset: XYCoord | null,
  currentOffset: XYCoord | null,
  clientOffset: XYCoord | null,
) {
  if (!initialOffset || !currentOffset || !clientOffset) {
    return {
      display: 'none',
    };
  }

  const { y } = currentOffset;
  const { x } = clientOffset;

  const transform = `translate(${x}px, ${y}px)`;
  return {
    transform,
    WebkitTransform: transform,
  };
}
