use prost_reflect::prost::Message;
use prost_reflect::{DynamicMessage, MethodDescriptor};
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::Status;

#[derive(Clone)]
pub struct DynamicCodec(MethodDescriptor);

impl DynamicCodec {
    #[allow(dead_code)]
    pub fn new(md: MethodDescriptor) -> Self {
        Self(md)
    }
}

impl Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = Self;
    type Decoder = Self;

    fn encoder(&mut self) -> Self::Encoder {
        self.clone()
    }

    fn decoder(&mut self) -> Self::Decoder {
        self.clone()
    }
}

impl Encoder for DynamicCodec {
    type Item = DynamicMessage;
    type Error = Status;

    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        item.encode(dst)
            .expect("buffer is too small to decode this message");
        Ok(())
    }
}

impl Decoder for DynamicCodec {
    type Item = DynamicMessage;
    type Error = Status;

    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        let mut msg = DynamicMessage::new(self.0.output());
        msg.merge(src)
            .map_err(|err| Status::internal(err.to_string()))?;
        Ok(Some(msg))
    }
}
