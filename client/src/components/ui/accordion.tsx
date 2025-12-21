"use client";

import { Accordion as ChakraAccordion } from "@chakra-ui/react";
import * as React from "react";
import { LuChevronDown } from "react-icons/lu";

interface AccordionItemTriggerProps extends ChakraAccordion.ItemTriggerProps {
  indicatorPlacement?: "start" | "end";
}

export const AccordionItemTrigger = React.forwardRef<HTMLButtonElement, AccordionItemTriggerProps>(
  function AccordionItemTrigger(props, ref) {
    const { children, indicatorPlacement = "start", ...rest } = props;
    return (
      <ChakraAccordion.ItemTrigger ref={ref} {...rest}>
        {indicatorPlacement === "start" && (
          <ChakraAccordion.ItemIndicator rotate={{ base: "-90deg", _open: "0deg" }}>
            <LuChevronDown />
          </ChakraAccordion.ItemIndicator>
        )}
        {children}
        {indicatorPlacement === "end" && (
          <ChakraAccordion.ItemIndicator rotate={{ base: "-90deg", _open: "0deg" }}>
            <LuChevronDown />
          </ChakraAccordion.ItemIndicator>
        )}
      </ChakraAccordion.ItemTrigger>
    );
  },
);

export const AccordionItemContent = React.forwardRef<HTMLDivElement, ChakraAccordion.ItemContentProps>(
  function AccordionItemContent(props, ref) {
    return (
      <ChakraAccordion.ItemContent ref={ref} {...props}>
        <ChakraAccordion.ItemBody p={0}>{props.children}</ChakraAccordion.ItemBody>
      </ChakraAccordion.ItemContent>
    );
  },
);

export const AccordionRoot = ChakraAccordion.Root;
export const AccordionItem = ChakraAccordion.Item;
export const AccordionItemIndicator = ChakraAccordion.ItemIndicator;
