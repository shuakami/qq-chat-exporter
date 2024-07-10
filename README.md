<div align="center"><img src="banner-0103.png" alt="QQ Chat Exporter Banner"># QQ Chat Exporter[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)[![Python Version](https://img.shields.io/badge/python-3.7%2B-blue)](https://www.python.org/downloads/)[![GitHub Stars](https://img.shields.io/github/stars/shuakami/qq-chat-exporter.svg)](https://github.com/shuakami/qq-chat-exporter/stargazers)[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/shuakami/qq-chat-exporter)English | [简体中文](README_zh.md)🚀 Export your QQ chat history 🚀[Features](#features) • [Quick Start](#quick-start) • [Detailed Guide](#detailed-guide) • [FAQ](#faq) • [Contributing](#contributing) • [License](#license)</div>## FeaturesQQ Chat Exporter is an innovative tool developed to solve the difficulty of exporting chat history for QQ users. It offers the following core functionalities:- 🖥️ **Intelligent Window Recognition**: Automatically locates and focuses on the QQ chat window- 💬 **Precise Message Extraction**: Accurately identifies and copies chat message content- 👥 **User Differentiation**: Intelligently distinguishes between your messages and others'- 📊 **Structured Storage**: Saves exported messages in an easily processable JSON format- 🖱️ **Automatic Scrolling**: Simulates mouse scrolling to retrieve more historical messages- 🛡️ **Safe Operation**: Built-in protection mechanism to avoid accidental clicks on critical areas## Quick Start### Prerequisites- Python 3.7+- Windows operating system- Recommended NT QQ version 9.9.10-23873 (64-bit)### Installation Steps1. Clone the repository (or download the repository's zip file and extract it):   ```   git clone https://github.com/shuakami/qq-chat-exporter.git   ```2. Enter the project directory:   ```   cd qq-chat-exporter   ```3. Install dependencies:   ```   pip install -r requirements.txt   ```### Basic Usage1. Configure message colors (in `qq.py`):   ```python   my_message_color = (0, 153, 255)  # Your message color   other_message_color = (241, 252, 247)  # Others' message color   ```2. Run `fuck_down_test.py` to get the non-clickable area3. Replace the non-clickable area parameters in `qq.py`   ```python   # Non-clickable area   # Please run fuck_down_test.py to get and replace the following part   avoid_area = [(1248, 589), (1299, 589), (1249, 611), (1299, 613)]   ```4. Run the main script:   ```   python qq.py   ```## Detailed Guide### 1. Environment PreparationEnsure your system meets the following requirements:- Windows operating system (Windows 10 or higher recommended)- Python 3.7 or higher version- Stable internet connection (for installing dependencies)### 2. Installation ProcessAfter cloning the repository, we need to install the necessary Python libraries. The `requirements.txt` file contains the following dependencies:```pyautogui==0.9.53  # For simulating mouse and keyboard operationsopencv-python==4.5.5.64  # For image processing and recognitionpillow==8.4.0  # For image manipulationpywin32==301  # For Windows system interactionnumpy==1.21.5  # For numerical computations```Running `pip install -r requirements.txt` will automatically install these libraries.## Configuration Details### Message Color SettingsIn the `qq.py` file, you need to set two colors:```pythonmy_message_color = (0, 153, 255)  # Blueother_message_color = (241, 252, 247)  # Light green```These RGB values determine how the script identifies different message bubbles. You may need to adjust these according to your QQ theme.### Non-clickable AreaRun `fuck_down_test.py` and follow the prompts. This script will help you locate sensitive areas in the QQ window to prevent the script from triggering unnecessary operations.Steps:1. Run the script2. In the QQ window, right-click on the four corners of the sensitive area, starting from the top-left3. The script will output coordinates, update these coordinates in the `avoid_area` variable in `qq.py`### 4. Running the ScriptOnce ready, run `python qq.py`. The script will automatically:- Locate the QQ window- Identify and copy messages- Save messages to the `training_data.json` file### 5. Precautions- Do not operate the computer while the script is running to avoid interfering with the automation process- If interrupted by special content (such as images, files), manually click on another area to continue, or press Ctrl+C to restart- It's recommended to use a plain or high-contrast wallpaper to improve recognition accuracy## FAQ1. **Q: What if the script can't recognize the QQ window?**   A: Ensure the QQ window is active and not minimized. Try restarting both QQ and the script.2. **Q: How to solve inaccurate message color recognition?**   A: Fine-tune the RGB values of `my_message_color` and `other_message_color`. You can use a screen color picker tool to get precise colors.3. **Q: How to handle a large amount of historical messages?**   A: The script is designed to automatically scroll and process messages. For particularly long chat histories, you may need to run the script multiple times.4. **Q: What to do if the script suddenly stops during execution?**   A: This may be due to encountering images, special chat records, or other interfering elements. Please manually click on another area of the chat window to continue, or press Ctrl+C to terminate the script and restart.5. **Q: Why do we need to run fuck_down_test.py?**   A: This script helps determine the coordinates of non-clickable areas. These areas typically contain elements that might interfere with the export process. If you're unsure what this element is, please check `dist/fuck_down.png` in the repository.6. **Q: Why does the wallpaper affect script operation?**   A: The script distinguishes messages by recognizing specific colors. If the wallpaper color is similar to the message bubble color, it may cause misidentification. It's recommended to use a plain wallpaper with high contrast to the message colors.7. **Q: Can I leave it unattended during execution?**   A: During execution, you must watch it run. Sometimes it might click on images, chat records, or other things that interrupt the process. You need to click elsewhere to continue, or use Ctrl+C to restart.8. **Q: How to ensure all messages are correctly exported?**   A: The script automatically processes visible messages but may not handle hidden content. It's recommended to manually scroll to the desired starting position before exporting, and check the output file after the script completes.9. **Q: How to use the exported JSON file?**   A: The exported JSON file contains structured chat data that can be used for data analysis, backup, or import into other applications. You can use Python's json module or other JSON processing tools to read and process this data.## ContributingWe welcome and encourage community contributions! If you have any improvement suggestions or have found a bug, please:1. Fork this repository2. Create your feature branch (`git checkout -b feature/AmazingFeature`)3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)4. Push to the branch (`git push origin feature/AmazingFeature`)5. Open a Pull Request### Contribution GuidelinesTo maintain the quality and consistency of the project, please follow these guidelines:- Adhere to the [PEP 8](https://www.python.org/dev/peps/pep-0008/) coding standards- Write unit tests for new features- Update documentation to reflect your changes- Keep commit messages concise and clear## LicenseThis project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more information.## Tech Stack- [OpenCV](https://opencv.org/) - [PyAutoGUI](https://pyautogui.readthedocs.io/) ## Changelog### Version 1.0.0 (2024-7-10)- Initial release- Implemented basic QQ chat history export functionality- Added automatic scrolling and message recognition features## DisclaimerQQ Chat Exporter is an open-source tool designed to help users export their personal chat history. When using this tool, please be aware of the following:1. **Legal Use**: This tool is for personal legal use only. Users should ensure they have the right to export chat records and comply with all applicable laws and regulations.2. **Privacy Protection**: Please respect others' privacy. Do not export or share others' chat records without permission.3. **Data Security**: Exported chat records may contain sensitive information. Users are responsible for properly safeguarding and using this data.4. **Liability Disclaimer**: The developers and contributors of this project are not responsible for any direct or indirect losses caused by using this tool, including but not limited to data loss, privacy breaches, or legal disputes.5. **Unofficial Tool**: QQ Chat Exporter is not affiliated with Tencent or QQ. It is an independent third-party tool.6. **Risk Assumption**: By using this tool, you agree to assume all risks associated with its use.7. **Copyright Notice**: This tool does not store or transmit any chat content and only runs on the user's local device. Users should ensure compliance with relevant copyright laws.8. **Technical Limitations**: Due to potential QQ updates, the functionality of this tool may be affected. We do not guarantee that the tool will work in all circumstances.By using this tool, you acknowledge that you have read, understood, and agree to abide by the above disclaimer. If you do not agree to these terms, please do not use this tool.## Project Status![Project Status](https://img.shields.io/badge/status-active-brightgreen.svg)QQ Chat Exporter is currently in active development. We regularly release updates and bug fixes. Feel free to follow this project for the latest developments.---<div align="center">**Like this project? Please give us a ⭐️!**</div>