//! 消息解析层：NapCat `RawMessage` → `CleanMessage`。

pub mod multi_forward_xml;
pub mod simple_parser;

pub use simple_parser::{ForwardFetcher, SimpleMessageParser, SimpleParserOptions};
