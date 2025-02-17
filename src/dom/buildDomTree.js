const buildDomTree = (
    args = {
      doHighlightElements: true,
      focusHighlightIndex: -1,
      viewportExpansion: 0,
    }
  ) => {
    const { doHighlightElements, focusHighlightIndex, viewportExpansion } = args;
    let highlightIndex = 0; // Reset highlight index
  
    /**
     * Hash map of DOM nodes indexed by their highlight index.
     *
     * @type {Object<string, any>}
     */
    const DOM_HASH_MAP = {};
  
    const ID = { current: 0 };
  
    // Quick check to confirm the script receives focusHighlightIndex
    console.log("focusHighlightIndex:", focusHighlightIndex);
  
    const HIGHLIGHT_CONTAINER_ID = "playwright-highlight-container";
  
    /**
     * Highlights an element in the DOM and returns the index of the next element.
     */
    function highlightElement(element, index, parentIframe = null) {
      // Create or get highlight container
      let container = document.getElementById(HIGHLIGHT_CONTAINER_ID);
      if (!container) {
        container = document.createElement("div");
        container.id = HIGHLIGHT_CONTAINER_ID;
        container.style.position = "absolute";
        container.style.pointerEvents = "none";
        container.style.top = "0";
        container.style.left = "0";
        container.style.width = "100%";
        container.style.height = "100%";
        container.style.zIndex = "2147483647"; // Maximum z-index value
  
        document.body.appendChild(container);
      }
  
      // Generate a color based on the index
      const colors = [
        "#FF0000",
        "#00FF00",
        "#0000FF",
        "#FFA500",
        "#800080",
        "#008080",
        "#FF69B4",
        "#4B0082",
        "#FF4500",
        "#2E8B57",
        "#DC143C",
        "#4682B4",
      ];
      const colorIndex = index % colors.length;
      const baseColor = colors[colorIndex];
      const backgroundColor = `${baseColor}1A`; // 10% opacity version of the color
  
      // Create highlight overlay
      const overlay = document.createElement("div");
      overlay.style.position = "absolute";
      overlay.style.border = `2px solid ${baseColor}`;
      overlay.style.backgroundColor = backgroundColor;
      overlay.style.pointerEvents = "none";
      overlay.style.boxSizing = "border-box";
  
      // Position overlay based on element, including scroll position
      const rect = element.getBoundingClientRect();
      let top = rect.top + window.scrollY;
      let left = rect.left + window.scrollX;
  
      // Adjust position if element is inside an iframe
      if (parentIframe) {
        const iframeRect = parentIframe.getBoundingClientRect();
        top += iframeRect.top;
        left += iframeRect.left;
      }
  
      overlay.style.top = `${top}px`;
      overlay.style.left = `${left}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
  
      // Create label
      const label = document.createElement("div");
      label.className = "playwright-highlight-label";
      label.style.position = "absolute";
      label.style.background = baseColor;
      label.style.color = "white";
      label.style.padding = "1px 4px";
      label.style.borderRadius = "4px";
      label.style.fontSize = `${Math.min(12, Math.max(8, rect.height / 2))}px`; // Responsive font size
      label.textContent = index;
  
      // Calculate label position
      const labelWidth = 20; // Approximate width
      const labelHeight = 16; // Approximate height
  
      // Default position (top-right corner inside the box)
      let labelTop = top + 2;
      let labelLeft = left + rect.width - labelWidth - 2;
  
      // Adjust if box is too small
      if (rect.width < labelWidth + 4 || rect.height < labelHeight + 4) {
        // Position outside the box if it's too small
        labelTop = top - labelHeight - 2;
        labelLeft = left + rect.width - labelWidth;
      }
  
      label.style.top = `${labelTop}px`;
      label.style.left = `${labelLeft}px`;
  
      // Add to container
      container.appendChild(overlay);
      container.appendChild(label);
  
      // Store reference for cleanup
      element.setAttribute(
        "browser-user-highlight-id",
        `playwright-highlight-${index}`
      );
  
      return index + 1;
    }
  
    /**
     * Returns an XPath tree string for an element.
     */
    function getXPathTree(element, stopAtBoundary = true) {
      const segments = [];
      let currentElement = element;
  
      while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
        // Stop if we hit a shadow root or iframe
        if (
          stopAtBoundary &&
          (currentElement.parentNode instanceof ShadowRoot ||
            currentElement.parentNode instanceof HTMLIFrameElement)
        ) {
          break;
        }
  
        let index = 0;
        let sibling = currentElement.previousSibling;
        while (sibling) {
          if (
            sibling.nodeType === Node.ELEMENT_NODE &&
            sibling.nodeName === currentElement.nodeName
          ) {
            index++;
          }
          sibling = sibling.previousSibling;
        }
  
        const tagName = currentElement.nodeName.toLowerCase();
        const xpathIndex = index > 0 ? `[${index + 1}]` : "";
        segments.unshift(`${tagName}${xpathIndex}`);
  
        currentElement = currentElement.parentNode;
      }
  
      return segments.join("/");
    }
  
    // Helper function to check if element is accepted
    function isElementAccepted(element) {
      const leafElementDenyList = new Set([
        "svg",
        "script",
        "style",
        "link",
        "meta",
      ]);
      return !leafElementDenyList.has(element.tagName.toLowerCase());
    }
  
    /**
     * Checks if an element is interactive.
     */
    function isInteractiveElement(element) {
      // 基本的交互式元素标签
      const interactiveTags = new Set([
          'a', 'button', 'input', 'select', 'textarea', 'summary', 'video',
          'audio', 'iframe', 'details', '[role="button"]', '[role="link"]',
          '[role="searchbox"]', '[role="textbox"]', '[role="combobox"]'
      ]);
  
      // 检查元素是否是基本的交互式元素
      if (interactiveTags.has(element.tagName.toLowerCase())) {
          return true;
      }
  
      // 检查元素的角色
      const role = element.getAttribute('role');
      if (role && interactiveTags.has(`[role="${role}"]`)) {
          return true;
      }
  
      // 检查特定的类名或属性
      const hasInteractiveClass = element.className && (
          element.className.includes('clickable') ||
          element.className.includes('button') ||
          element.className.includes('input') ||
          element.className.includes('select') ||
          element.className.includes('search')
      );
  
      if (hasInteractiveClass) {
          return true;
      }
  
      // 检查是否有点击事件监听器
      const hasClickListener = element.onclick !== null || 
          element.getAttribute('onclick') !== null ||
          element.getAttribute('ng-click') !== null ||
          element.getAttribute('@click') !== null;
  
      if (hasClickListener) {
          return true;
      }
  
      // 检查特定的数据属性
      const hasDataInteractive = Array.from(element.attributes)
          .some(attr => attr.name.startsWith('data-') && (
              attr.name.includes('click') ||
              attr.name.includes('action') ||
              attr.name.includes('target') ||
              attr.name.includes('toggle')
          ));
  
      if (hasDataInteractive) {
          return true;
      }
  
      // 检查父元素是否是表单控件
      const isFormControl = element.closest('form') !== null &&
          (element.tagName.toLowerCase() === 'div' || element.tagName.toLowerCase() === 'span');
  
      if (isFormControl) {
          return true;
      }
  
      // 检查是否有特定的占位符或标签
      const hasPlaceholder = element.getAttribute('placeholder') !== null;
      const hasAriaLabel = element.getAttribute('aria-label') !== null;
  
      if (hasPlaceholder || hasAriaLabel) {
          return true;
      }
  
      return false;
    }
  
    /**
     * Checks if an element is visible.
     */
    function isElementVisible(element) {
      const style = window.getComputedStyle(element);
      return (
        element.offsetWidth > 0 &&
        element.offsetHeight > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    }
  
    /**
     * Checks if an element is the top element at its position.
     */
    function isTopElement(element) {
      // Find the correct document context and root element
      let doc = element.ownerDocument;
  
      // If we're in an iframe, elements are considered top by default
      if (doc !== window.document) {
        return true;
      }
  
      // For shadow DOM, we need to check within its own root context
      const shadowRoot = element.getRootNode();
      if (shadowRoot instanceof ShadowRoot) {
        const rect = element.getBoundingClientRect();
        const point = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
  
        try {
          // Use shadow root's elementFromPoint to check within shadow DOM context
          const topEl = shadowRoot.elementFromPoint(point.x, point.y);
          if (!topEl) return false;
  
          // Check if the element or any of its parents match our target element
          let current = topEl;
          while (current && current !== shadowRoot) {
            if (current === element) return true;
            current = current.parentElement;
          }
          return false;
        } catch (e) {
          return true; // If we can't determine, consider it visible
        }
      }
  
      // Regular DOM elements
      const rect = element.getBoundingClientRect();
  
      // If viewportExpansion is -1, check if element is the top one at its position
      if (viewportExpansion === -1) {
        return true; // Consider all elements as top elements when expansion is -1
      }
  
      // Calculate expanded viewport boundaries including scroll position
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const viewportTop = -viewportExpansion + scrollY;
      const viewportLeft = -viewportExpansion + scrollX;
      const viewportBottom = window.innerHeight + viewportExpansion + scrollY;
      const viewportRight = window.innerWidth + viewportExpansion + scrollX;
  
      // Get absolute element position
      const absTop = rect.top + scrollY;
      const absLeft = rect.left + scrollX;
      const absBottom = rect.bottom + scrollY;
      const absRight = rect.right + scrollX;
  
      // Skip if element is completely outside expanded viewport
      if (
        absBottom < viewportTop ||
        absTop > viewportBottom ||
        absRight < viewportLeft ||
        absLeft > viewportRight
      ) {
        return false;
      }
  
      // For elements within expanded viewport, check if they're the top element
      try {
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
  
        // Only clamp the point if it's outside the actual document
        const point = {
          x: centerX,
          y: centerY,
        };
  
        if (
          point.x < 0 ||
          point.x >= window.innerWidth ||
          point.y < 0 ||
          point.y >= window.innerHeight
        ) {
          return true; // Consider elements with center outside viewport as visible
        }
  
        const topEl = document.elementFromPoint(point.x, point.y);
        if (!topEl) return false;
  
        let current = topEl;
        while (current && current !== document.documentElement) {
          if (current === element) return true;
          current = current.parentElement;
        }
        return false;
      } catch (e) {
        return true;
      }
    }
  
    /**
     * Checks if a text node is visible.
     */
    function isTextNodeVisible(textNode) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rect = range.getBoundingClientRect();
  
      return (
        rect.width !== 0 &&
        rect.height !== 0 &&
        rect.top >= 0 &&
        rect.top <= window.innerHeight &&
        textNode.parentElement?.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        })
      );
    }
  
    /**
     * Creates a node data object for a given node and its descendants and returns
     * the identifier of the node in the hash map or null if the node is not accepted.
     */
    function buildDomTree(node, parentIframe = null) {
      if (!node) {
        return null;
      }
  
      // NOTE: We skip highlight container nodes from the DOM tree
      //       by ignoring the container element itself and all its children.
      if (node.id === HIGHLIGHT_CONTAINER_ID) {
        return null;
      }
  
      // Special case for text nodes
      if (node.nodeType === Node.TEXT_NODE) {
        const textContent = node.textContent.trim();
        if (textContent && isTextNodeVisible(node)) {
          const id = `${ID.current++}`;
  
          DOM_HASH_MAP[id] = {
            type: "TEXT_NODE",
            text: textContent,
            isVisible: true,
          };
  
          return id;
        }
        return null;
      }
  
      // Check if element is accepted
      if (node.nodeType === Node.ELEMENT_NODE && !isElementAccepted(node)) {
        return null;
      }
  
      const nodeData = {
        tagName: node.tagName ? node.tagName.toLowerCase() : null,
        attributes: {},
        xpath:
          node.nodeType === Node.ELEMENT_NODE ? getXPathTree(node, true) : null,
        children: [],
      };
  
      // Add coordinates for element nodes
      if (node.nodeType === Node.ELEMENT_NODE) {
        const rect = node.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
  
        // Viewport-relative coordinates (can be negative when scrolled)
        nodeData.viewportCoordinates = {
          topLeft: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
          },
          topRight: {
            x: Math.round(rect.right),
            y: Math.round(rect.top),
          },
          bottomLeft: {
            x: Math.round(rect.left),
            y: Math.round(rect.bottom),
          },
          bottomRight: {
            x: Math.round(rect.right),
            y: Math.round(rect.bottom),
          },
          center: {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          },
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
  
        // Page-relative coordinates (always positive, relative to page origin)
        nodeData.pageCoordinates = {
          topLeft: {
            x: Math.round(rect.left + scrollX),
            y: Math.round(rect.top + scrollY),
          },
          topRight: {
            x: Math.round(rect.right + scrollX),
            y: Math.round(rect.top + scrollY),
          },
          bottomLeft: {
            x: Math.round(rect.left + scrollX),
            y: Math.round(rect.bottom + scrollY),
          },
          bottomRight: {
            x: Math.round(rect.right + scrollX),
            y: Math.round(rect.bottom + scrollY),
          },
          center: {
            x: Math.round(rect.left + rect.width / 2 + scrollX),
            y: Math.round(rect.top + rect.height / 2 + scrollY),
          },
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
  
        // Add viewport and scroll information
        nodeData.viewport = {
          scrollX: Math.round(scrollX),
          scrollY: Math.round(scrollY),
          width: window.innerWidth,
          height: window.innerHeight,
        };
      }
  
      // Copy all attributes if the node is an element
      if (node.nodeType === Node.ELEMENT_NODE && node.attributes) {
        // Use getAttributeNames() instead of directly iterating attributes
        const attributeNames = node.getAttributeNames?.() || [];
        for (const name of attributeNames) {
          nodeData.attributes[name] = node.getAttribute(name);
        }
      }
  
      if (node.nodeType === Node.ELEMENT_NODE) {
        const isInteractive = isInteractiveElement(node);
        const isVisible = isElementVisible(node);
        const isTop = isTopElement(node);
  
        nodeData.isInteractive = isInteractive;
        nodeData.isVisible = isVisible;
        nodeData.isTopElement = isTop;
  
        // Highlight if element meets all criteria and highlighting is enabled
        if (isInteractive && isVisible && isTop) {
          nodeData.highlightIndex = highlightIndex++;
          if (doHighlightElements) {
            if (focusHighlightIndex >= 0) {
              if (focusHighlightIndex === nodeData.highlightIndex) {
                highlightElement(node, nodeData.highlightIndex, parentIframe);
              }
            } else {
              highlightElement(node, nodeData.highlightIndex, parentIframe);
            }
          }
        }
      }
  
      // Only add iframeContext if we're inside an iframe
      // if (parentIframe) {
      //     nodeData.iframeContext = `iframe[src="${parentIframe.src || ''}"]`;
      // }
  
      // Only add shadowRoot field if it exists
      if (node.shadowRoot) {
        nodeData.shadowRoot = true;
      }
  
      // Handle shadow DOM
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.childNodes) {
          const domElement = buildDomTree(child, parentIframe);
          if (domElement) {
            nodeData.children.push(domElement);
          }
        }
      }
  
      // Handle iframes
      if (node.tagName === "IFRAME") {
        try {
          const iframeDoc = node.contentDocument || node.contentWindow.document;
          if (iframeDoc) {
            for (const child of iframeDoc.body.childNodes) {
              const domElement = buildDomTree(child, node);
              if (domElement) {
                nodeData.children.push(domElement);
              }
            }
          }
        } catch (e) {
          console.warn("Unable to access iframe:", node);
        }
      } else {
        for (const child of node.childNodes) {
          const domElement = buildDomTree(child, parentIframe);
          if (domElement) {
            nodeData.children.push(domElement);
          }
        }
        // If it's an <a> element and has no visible content, return null
        if (nodeData.tagName === 'a' && nodeData.children.length === 0) {
          return null;
        }
      }
  
      // NOTE: We register the node to the hash map.
      const id = `${ID.current++}`;
      DOM_HASH_MAP[id] = nodeData;
  
      return id;
    }
  
    const rootId = buildDomTree(document.body);
  
    return { rootId, map: DOM_HASH_MAP };
  };
  
  // 直接设置为全局函数
  window.buildDomTree = buildDomTree;
  